# Self-assignable role panels (#63) — staging-only

**Status: source-only draft.** This feature requires a reviewed database
migration and staging acceptance before any production deployment.
No GitHub Actions workflow has been re-enabled, and no live Discord
roles, channels or databases have been changed by this PR.

## Administrator commands

Managers with **Manage Server AND Manage Roles** may configure panels
using Necord's nested Discord slash commands:

1. \`/role panel create channel:#roles title:Interests mode:buttons\`
   (or \`mode:select\`) creates a **draft**. It sends nothing.
2. \`/role panel add panel_id:17 role:@Games label:Games\` adds a
   self-assignable role to a draft.
3. Optionally set \`exclusive_group:color\` on several options in
   **the same panel** so selecting one removes other choices in
   that group. Different panels do **not** share exclusive groups.
4. Optionally set \`requires:@Verified\` to require a member to
   already have a prerequisite role before a new role is added.
   A member may still remove their own selected role later.
5. \`/role panel remove panel_id:17 option_id:1\` removes a draft
   option; \`/role panel list\` lists the latest panels in this guild.
6. \`/role panel publish panel_id:17\` checks live permissions and
   roles, reserves a publish in PostgreSQL, posts a button/select
   message, and activates that message by its real Discord ID.
7. \`/role panel disable panel_id:17\` immediately disables future
   interactions, then *best-effort* removes its visible buttons.
   This never removes roles from members.

A published panel is **immutable**: to change roles, disable it
and create a replacement draft. Each guild may have up to 20 current
draft/publishing/active panels (a best-effort quota under simultaneous
create commands). Each panel supports **10 buttons** (two rows of five)
or **25 dropdown options** (one single-select menu). Selecting an
option again toggles off that role. All replies are ephemeral,
except the explicitly published role-panel message.

Commands and component handlers are registered inside the existing
Nest \`BotModule\`/Necord integration. They do not require the
privileged Guild Members gateway intent, because the handler
force-fetches the **specific** interacting guild member over the
Discord API. The bot must be present in the guild.

## Permission and hierarchy rules

- Setup requires **both** Manage Server and Manage Roles on the
  current staff member; these are rechecked from Discord, not cached
  slash-command visibility. Except for the guild owner, staff must
  have a higher role than each self-role option.
- The bot requires **Manage Roles**, must have a highest role
  strictly above each option, and Discord must report it as
  manageable. Managed integration roles, \`@everyone\`,
  deleted/other-guild roles and roles with dangerous administrator,
  moderation or role-management permission bits are rejected.
  The same checks run when an option is configured, when a panel
  is published **and again on every click**. If a role moves
  upward or gains dangerous permissions, clicks fail closed.
- A role with no privileged role-level bits can **still** expose
  private channels through channel-specific overwrites.
  Managers must review channel access granted by every selectable
  role in the staging guild before publishing it. This bot does
  not automatically infer or approve those overwrites.
- Published controls use short IDs of the form
  \`yrole:b:PANEL:REVISION:OPTION\` or
  \`yrole:s:PANEL:REVISION\`. A click verifies the **exact**
  guild, channel, original Discord message, panel ID,
  stored revision, option ID and active status. Copying buttons
  to another message never grants roles.
- The member and bot are force-fetched on every interaction.
  Prerequisite roles must still exist and be held by that member.
  An invalid/deleted role, revoked bot permissions or missing
  member causes a safe denial. A prerequisite that is later
  removed by staff does **not** automatically revoke a previously
  assigned role; this is a one-time eligibility check.
- Exclusive groups are validated against circular prerequisites,
  self-prerequisites and group peers requiring each other.
  Groups apply **only within one published panel**. Managers
  should not mix the same role across conflicting panels.

The bot uses Discord's **single-role add/remove** API, never
\`member.roles.set()\`; it does not overwrite unrelated staff roles.
For exclusive groups, the chosen role is added first, then old
group members are removed one at a time. Discord does not offer an
atomic multi-role transaction. If an API call fails or the member
lease expires between calls, the database records a **partial**
or **uncertain** attempt and asks staff to reconcile. No
automatic rollback or retries are attempted.

## PostgreSQL idempotency, leases, and audit

\`backend/migrations/20261029_self_role_panels.sql\` adds:

- \`role_panels\`: per-guild panel, channel, publication state,
  Discord message ID, revision, validated JSONB options.
- \`role_panel_member_locks\`: short-lived **90-second** per-guild/
  per-member atomic PostgreSQL lease with a **3-second** cooldown.
  The lease is acquired using an \`INSERT ... ON CONFLICT ...
  WHERE expiresAt <= NOW() RETURNING\` statement. Another
  worker cannot acquire the same member lease while it is
  unexpired. Lease ownership is rechecked before role mutation
  and between exclusive-group removal calls. If a remote call
  takes longer than the lease duration, a cross-worker race is
  theoretically possible; keep operations bounded and inspect
  partial/uncertain results before retry.
- \`role_panel_actions\`: a unique Discord interaction ID,
  guild/member IDs, target option/role and an outcome of
  \`pending\`, \`added\`, \`removed\`, \`denied\`,
  \`partial\`, or \`uncertain\`.

An audit attempt is persisted **before** changing any Discord
roles; if the DB cannot record it, no role operation is initiated.
Identical interaction IDs cannot start multiple role mutations,
even after a process restart. Distinct interactions in the
same three-second cooldown are rejected to avoid rapid
accidental double toggles.

Panel publishing also reserves a unique **publishing** state
*before* calling Discord. If a send times out, or the bot
crashes after sending but before recording the message ID,
the panel remains **publishing/inert** rather than being
automatically republished. An administrator should inspect
the channel, disable the stuck panel, remove any orphan
message and create a fresh draft.

Audit records contain numeric IDs and outcome only, not member
messages or arbitrary member content. Old action audits are
pruned opportunistically after 30 days on new interactions.
Unused lease rows are pruned opportunistically; quiet guilds
require a durable cleanup process (#90/#91). Data is *not*
guaranteed to disappear at a specific time, and guild deletion
or member erasure needs a documented privacy cleanup procedure
before a production release.

## Verification and manual release checklist

1. Back up **staging PostgreSQL**. Apply all prior required migrations
   first, then \`backend/migrations/20261029_self_role_panels.sql\`.
   Check indexes, constraints, disabled-by-default behavior and
   TypeORM mapping with synchronization disabled.
2. With dependencies installed, run from \`backend/\`:
   \`npm ci\`, \`npm run build\`, \`npm test -- --runInBand\`
   and \`npm run test:e2e -- --runInBand\`.
   Keep **GitHub Actions disabled**.
3. In a **disposable Discord guild**, create harmless low-ranked
   cosmetic roles, a private test channel, a prerequisite role
   and two mutually exclusive colors. Put the bot's highest
   role above these roles and grant Manage Roles plus channel
   View/Send. Use consenting test members only.
4. Verify nonmanagers cannot use any admin slash subcommand.
   Managers lacking one of the required permissions must also
   be rejected. Create draft buttons and dropdowns, verify
   no sends before explicit publish and maximum limits.
5. Publish and test add/remove, role prerequisite, one
   exclusive-group switch, concurrent clicks from two bot
   workers, repeated interaction IDs and the cooldown.
   Verify staff/unrelated member roles are unaffected.
6. Remove/change a role's hierarchy or grant dangerous flags
   after publishing, then verify click denial. Delete the
   panel's channel/message and check disabled/stale/copy
   controls cannot grant roles. Restart the bot and repeat.
7. Force role add and group removal permission failures,
   network timeouts, database failures, publishing races,
   and a 90-second lease expiry. Verify pending/partial/
   uncertain action audits and absence of blind retries.
8. Disable the panel. Confirm controls stop working even
   if the visible message cannot be edited or deleted.
   Disable and remove all test messages after acceptance.
9. Review granted role channel-overwrite access, audit
   cleanup, guild deletion/erasure, and operational
   sign-off before attempting production deployment.

**Rollback:** Disable all active/publishing panels in each
guild before returning to code without panel support.
Leave additive tables until audit/privacy export or purge
has been approved. Never remove existing member roles
as a side effect of rollback.

**Keep issue #63 open** until complete NestJS/Jest/e2e
and live disposable-guild checks are finished. This
PR is not proof that Discord role mutations were tested.
