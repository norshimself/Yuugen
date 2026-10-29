# Member verification and quarantine (#64)

**Status: source-only, staging required.** This change is stacked on
[PR #107](https://github.com/norshimself/Yuugen/pull/107) (self-role
buttons and durable per-member locks). Review/merge #107 and apply its
migration first. GitHub Actions remain disabled. No Discord message,
role change, database migration, or production deployment was performed
while authoring this branch.

## Opt-in workflow

A guild manager with **Manage Server AND Manage Roles** may configure
an independent verification flow via these slash subcommands:

- \`/verify setup channel:#verify quarantine_role:@Unverified mode:button\`
  stores an unpublished **draft** and changes no member or channel roles.
  \`mode:question\` also requires a short single-line \`question\` (up to
  45 characters) and \`answer\` (up to 80 characters, no control text).
- \`/verify publish\` validates role hierarchy, channel visibility and
  guild access again, reserves publishing in PostgreSQL **before**
  sending a single button message, then makes it active using the
  actual Discord message ID.
- \`/verify status\` provides a manager-only configuration summary and
  20 latest **metadata-only** action records. Answers are not displayed.
- \`/verify disable\` immediately stops new quarantine/verification
  actions and makes controls inert. Best-effort removes the button.
  It **does not remove any member roles**.
- \`/verify override member:@User\` permits an authorized manager to
  reconcile a current unverified/uncertain session, or expressly exempt
  a pre-existing member not observed since setup. The operation
  **only removes** the saved quarantine role if present and otherwise
  marks the member released. There is no role grant or ban.

Each guild starts **unconfigured, disabled**. New join handling also
requires \`ENABLE_GUILD_MEMBERS_INTENT=true\` **and** the privileged
Guild Members intent enabled in Discord Developer Portal; the flag is
off by default. Manual verification setup refuses to enable while
the flag is off, and all join events are ignored if it is disabled.

This implementation never attempts automatic CAPTCHA solving or
pretends that a button/question proves human identity. The optional
question is a simple rules/onboarding check, **not anti-bot protection**.
It stores a random 16-byte salt and SHA-256 digest, not the plaintext
answer. The slash-command answer is still visible to the staff member
submitting it and to Discord as part of command handling. Do not use
passwords or sensitive secrets as verification answers.

## Conservative quarantine permission contract

**The bot does not change channel permission overwrites or create
roles.** A manager must prepare a dedicated, zero-permission role and
a public, readable verification channel in a disposable test guild.

Setup, publish and every new join fail closed unless all of the
following hold:

1. The role is in the correct guild, not \`@everyone\`, not integration
   managed, and below the bot's highest role. Discord must report it
   manageable; the bot needs **Manage Roles**. Setup staff must also
   outrank the role (except the guild owner).
2. The role grants **zero guild-wide permission bits**. Even seemingly
   harmless role-level grants are not accepted in this first iteration.
3. The bot can **View Channel** and **Send Messages** to the configured
   guild text verification channel.
4. The quarantine role **and @everyone** can View Channel for
   verification. In that channel, the quarantine role may only have
   explicit View Channel and Read Message History *allow* overwrites.
5. No other guild channel may be viewable to the quarantine role **or
   @everyone**, and no other channel/category may have an explicit
   *allow* overwrite for the quarantine role.

The @everyone check matters because Discord delivers the join event
**after** a member has joined, before the bot can attach quarantine.
An open #general channel would otherwise create a brief disclosure
window. Admins must configure channel visibility BEFORE enabling
verification. If the bot cannot fetch the complete guild channel
list, setup fails rather than guessing at isolation.

**Limitations:** Other bots, integrations, active threads, newly
created channels, unexpected role assignments and channel changes
outside Yuugen can still introduce access. The join listener rejects
members who already have another role at quarantine time, rather than
assuming those permissions are harmless. This is a conservative
safeguard, **not a security proof** for high-risk private information.
For hard entry restrictions, use Discord's native membership screening
and a properly private-by-default server.

## Event and release state machine

All data are guild scoped. \`guild_verification_configs\` holds
the draft/publishing/active/disabled revision, channel, role and
optional salted answer proof. A published configuration is immutable.
To change it, disable it and create a new draft. Existing sessions
retain their original role ID for safe manual reconciliation.

\`guild_verification_sessions\` has one row per guild/member.
Each join is bound to Discord's real \`joinedTimestamp\`; gateway
replays of that session do nothing, a **newer** timestamp atomically
replaces the old session, and older/out-of-order joins cannot
overwrite it. Joins delayed beyond two minutes are ignored.
Sessions progress through:

- \`join_pending\` → \`quarantined\` after a confirmed quarantine role
  addition and force-fetched membership check
- \`join_pending\` → \`join_failed\` or \`join_uncertain\` when the
  safety check, API call or Discord confirmation does not succeed
- \`quarantined\` → \`release_pending\` → \`released\` only after
  a verified button/modal or an explicit staff override that removes
  the quarantine role and then force-fetches it as absent
- \`release_pending\` → \`release_uncertain\` for ambiguous
  Discord outcomes, or back to \`quarantined\` if no role mutation
  was attempted and a prerequisite changed.

No other roles are ever assigned on success. Rejoin invalidates
old session modals; the button validates the exact source guild,
channel, original message ID and revision. Only the real
Discord-authenticated member can act for their current session.
An unverified member may not use **PR #107 self-role buttons or
dropdowns**: the self-role listener queries the verification state,
checks for a currently held quarantine role even after a previous
release, and denies access if the verification database is unavailable.
This guard also covers existing members who have no post-enable
session record until staff explicitly overrides them.

Question mode displays a modal, normalizes the submitted answer
and performs a constant-time comparison against the salted digest.
Wrong answers are never persisted or logged, only a fixed failure
kind and a count (at most **five** per membership session).
Further attempts require staff override. A member can click again
for revalidation, but a delivered Discord interaction ID cannot
cause duplicate role operations.

## Persistence, concurrency and failure policy

\`guild_verification_actions\` stores only guild/member/actor IDs,
join timestamp, a unique Discord interaction ID (or synthetic
join-session key), action type and status:
\`pending\`, \`succeeded\`, \`denied\`, \`failed\`, \`uncertain\`.
No message text, submitted answers, member names or webhook tokens
are stored. Each audit attempt is inserted **before** mutating roles.

Verification reuses PR #107's atomic PostgreSQL **per-guild/member
90-second lease** and 3-second post-mutation cooldown. The bot rechecks
current membership/role rights, configuration revision and lease
ownership immediately before release. Duplicate clicks and concurrent
workers cannot begin independent role changes while a lease is active.
A Discord API call lasting more than the lease can still overlap with
a later worker; Discord has no multi-worker transaction or
exactly-once role mutation primitive. No automatic retry, rollback
or escalation is attempted for uncertain results; staff must inspect
live roles and use explicit \`/verify override\` to reconcile.

If the configured role becomes unmanageable or role access becomes
unsafe after publication, joins fail closed and self-role assignment
remains blocked. If quarantine role assignment fails, the member may
not self-verify, even if the UI is visible: staff must correct setup
and use override. Disabling the flow does not implicitly release
members already quarantined; the staff must manually reconcile them.

Old action audits are removed opportunistically after 30 days upon
new activity; manager history excludes older rows. **Current
membership sessions and quarantine/override receipts remain until
guild/member privacy deletion** to avoid bypasses or repeated
automatic onboarding. Quiet guilds have no guaranteed scheduled
physical purge. A production release requires explicit durable
retention and user/guild erasure procedures (#90/#91).

## Manual release acceptance checklist

1. Review PR #107 first. Back up **staging PostgreSQL** and apply
   \`20261029_self_role_panels.sql\` then
   \`backend/migrations/20261029_verification_quarantine.sql\`.
   Check constraints, uniqueness and entity mappings. Disable TypeORM
   schema synchronization. No production database modification.
2. With dependencies available, run \`npm ci && npm run build &&
   npm test -- --runInBand && npm run test:e2e -- --runInBand\` from
   \`backend/\`. GitHub Actions must remain **disabled**.
3. Create a disposable Discord guild with consenting test members.
   Enable Guild Members intent in both application environment and
   Discord Developer Portal. Put the bot's role above the dedicated
   zero-permission quarantine role. Give bot Manage Roles and
   verification-channel View/Send permissions.
4. Verify **@everyone cannot view any channel other than the
   verification channel** (unless no other channels exist) and the
   quarantine role has no dangerous allows. Attempt setup with a
   visible #general channel, a managed role, an admin-role bit, a
   forbidden overwrite and missing bot permissions: each must fail.
5. Verify setup creates a draft but **does not send**. Publish, inspect
   the button, test no unauthorized staff can configure/override,
   and re-run tests after changing bot hierarchy.
6. Join a consenting test member. Confirm one quarantine-role add,
   a durable session/audit before the Discord call, duplicate gateway
   replay suppression, old join timestamps, and a fresh session on
   leave/rejoin. Confirm no new role is assigned on verification.
7. Test button acceptance, a one-question modal, wrong answers and
   five-attempt lockout, button copied to another message, disabled
   panels, old modal after rejoin, missing bot rights, deleted role
   and uncertain Discord responses.
8. With PR #107's role panel enabled, ensure an unverified member
   cannot self-assign through any button or dropdown; DB errors must
   fail closed. Verify a released member can use self-role menus
   unless staff re-applies quarantine.
9. Test two bot workers racing to quarantine/release the same
   member, session turnover, 90-second lease expiry, cooldown,
   uncertain results and staff overrides. Check action metadata only.
10. Disable verification. Confirm no automatic release of existing
    members, ensure staff can safely reconcile or exempt them,
    delete test messages, and review privacy erasure design.

**Rollback:** Disable verification through the manager command
before returning to older application code. Review/release any
remaining quarantined members manually. Do not drop session/action
tables before approved export or deletion. Never blindly remove
or grant roles as part of rollback.

**Issue #64 remains open** until the full NestJS build, Jest/e2e,
database migration, real disposable-guild verification, and
privacy/security sign-off have all passed.
