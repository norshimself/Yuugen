# Issue #62 — goodbye messages and first-time onboarding

**Source-only draft. All new features disabled by default.** No GitHub
Actions workflow has been re-enabled and no database migrations, production
deployments, live Discord role operations or member DMs were performed.

## Admin-configurable settings

The existing JWT-protected, live Discord **Manage Server**-guarded
\`GET/POST /api/v1/settings?guildId=...\` endpoints continue to manage
\`guild_settings\`, and the existing guild-settings page exposes new controls.

| Setting | Default | Effect |
| --- | --- | --- |
| \`goodbyeChannelId\` | \`null\` | No goodbye unless an explicit guild text channel is selected |
| \`goodbyeMessage\` | \`Goodbye {user} from {guild}.\` | Public goodbye template, 1–1500 chars |
| \`welcomeDmEnabled\` | \`false\` | Send one first-time welcome DM to each observed guild member |
| \`welcomeDmMessage\` | \`Welcome to {guild}, {user}!\` | Private onboarding template, 1–1500 chars |
| \`rulesAcknowledgementEnabled\` | \`false\` | Add rules link and optional “I have read the rules” button to that DM |
| \`rulesChannelId\` | \`null\` | Rules destination must be a guild text channel visible to new members |

Acknowledge requires both \`welcomeDmEnabled=true\` and a valid rules channel
configured. The bot does not choose \`#general\`, \`#rules\` or arbitrary
channels by name when a destination is empty. Existing welcome channel,
template, image fallback and guild settings are retained.

Templates support case-insensitive \`{user}\` and \`{guild}\` placeholders.
Public welcomes may ping **only the joining user**. Goodbye and all DM sends
have \`allowedMentions: { parse: [] }\`: mass, role and user pings are disabled
there. Substituted user/guild names are length-bounded and control characters
are stripped. No user-supplied role, moderation action, or URL is interpolated
by the bot itself; links are constructed only from validated numeric IDs.

New channel selections must belong to the managed guild. For public welcome
and goodbye, the bot must have View Channel + Send Messages, verified on
save and again at delivery. An enabled rules link must be a real text
channel visible to \`@everyone\` / newly joining members; current
membership is rechecked when sending the DM. The rules link is
\`https://discord.com/channels/<guild id>/<channel id>\` and does not
expose a secret or token. Clearing a channel is always allowed when it
has been deleted or the bot loses permissions. A private onboarding
DM may be sent even if public announcements are disabled.

## Discord gateway and acknowledgement behavior

**Guild Members** privileged intent is required for join/departure
events. Enable \`ENABLE_GUILD_MEMBERS_INTENT=true\` in a disposable
test environment **and** the corresponding intent in Discord Developer
Portal; it is \`false\` by default. Bot members, stale join events
(over two minutes old) and entries with missing/invalid join timestamps
are ignored. On reconnect, a replayed join cannot generate another
same-session public message or another first-time DM.

The optional rules button is embedded in the member's DM and contains
a guild ID and the original join timestamp. The click is validated
against the **actual authenticated interaction user**, their current
membership in the guild, the exact current join session, current
guild settings and a **seven-day expiry**. The database conditionally
writes \`acknowledgedAt\` only once. A member cannot acknowledge for
another user, after leaving/rejoining, or after the guild disables the
rules flow. Clicking confirms a member pressed a button; **it does
not prove rules were read** and grants no roles, privileges or
moderation immunity. No automatic kick, quarantine or punishment is
associated with this button. Disabled DMs (Discord 50007) are treated
as a normal privacy outcome: no fallback public ping is sent.

## Delivery durability, bounds and privacy

\`guild_onboarding_receipts\` holds numeric guild/user IDs, an event kind,
session timestamp, occurrence time, time-bucket/slot, delivery status
and optional acknowledgement time. **No DM body, message text, nickname,
avatar, rules content or Discord token is stored in the receipt.**

PostgreSQL unique indexes on \`(guildId,userId,kind,sessionKey)\` and
a partial unique index on \`(guildId,userId)\` for \`welcome_dm\`
prevent duplicate gateway events, reconnects, concurrent workers and
second first-time DMs. A unique \`(guildId,minuteBucket,slot)\` index
limits **all onboarding sends to 30 delivery reservations/minute/guild**.
Above this cap, some legitimate announcements/DMs are silently omitted.
This is not an exhaustive member activity log.

A receipt is reserved as \`pending\` **before** Discord delivery. On
confirmed successful delivery it becomes \`sent\`; missing permissions,
a disabled/changed destination and confirmed DM privacy refusal become
\`failed\`. Ambiguous network errors remain \`pending\` and are **not
retried**: Discord might already have delivered the message. Image
**preparation** failures can fall back to text before a single send;
a possibly successful image-message send is never followed by a blind
text retry. Staff may need to reconcile pending receipts out of band.

Public welcome/goodbye receipts older than 30 days are deleted
opportunistically when new events are processed, at most every ten
minutes per guild/worker. The first-DM receipt is retained to remember
that a member was already onboarded, **even across re-joins/restarts**.
This is a privacy/deletion lifecycle dependency for #91: a production
release must define guild removal, user erasure requests, and orphaned
DM-marker cleanup without resending unsolicited onboarding messages.
No fixed-duration automatic deletion for this durable marker is claimed.

## Staging acceptance (before enabling any guild)

1. Back up **staging PostgreSQL**, apply prior required migrations,
   and apply \`backend/migrations/20261029_onboarding_goodbye_rules.sql\`.
   Verify all added guild fields are disabled/null by default and
   unique/partial indexes exist. Do not enable TypeORM schema sync
   in production.
2. With local dependencies installed, run \`npm ci\`,
   \`npm run build\`, \`npm test -- --runInBand\` and
   \`npm run test:e2e -- --runInBand\` inside \`backend/\`.
   Run frontend type/build checks independently. **Do not re-enable
   GitHub Actions**.
3. Create a disposable guild and consented test members. Ensure
   Guild Members intent is enabled in the bot and portal. Verify
   no events fire when the environment flag is disabled and no
   announcement occurs until a channel is selected.
4. Configure goodbye-only. Verify correct channel ID, a single post
   for duplicate leave events, placeholders, no pings, deleted channel,
   missing Send Messages and no arbitrary fallback.
5. Configure welcome-only; force image-render errors and verify exactly
   one text send. Simulate an *ambiguous send error* and confirm no
   second fallback send. Verify only the joiner may be mentioned.
6. Enable first-time DM without a public welcome. Join, leave, rejoin,
   restart and replay the same gateway event. Confirm at most one
   DM for the guild/user, and that Discord error 50007 never causes
   unsolicited channel pings.
7. Enable rules link in a channel visible to ordinary new members.
   Verify guild/member binding, DM link, one-time button click, expiry,
   previous-session click after rejoin, old user/other user attempts,
   disabled feature, and no automatic role assignment.
8. Exercise two bot workers and at least 31 events/minute to validate
   PostgreSQL uniqueness and rate limiting. Review pending/failed
   delivery receipts and the privacy deletion plan.
9. Disable all test settings and stop the disposable bot after testing.
   Obtain full staging sign-off before merging or deploying.

**Rollback:** Set \`welcomeDmEnabled=false\`,
\`rulesAcknowledgementEnabled=false\` and clear any
\`goodbyeChannelId\` **before** rolling the app back to code without
these settings. Keep additive columns/receipts until their retention,
exports and privacy deletion process has been reviewed. Never drop
unexported user-consent records without approval.

**Issue #62 stays open** until full build/Jest/e2e, frontend checks,
Discord staging acceptance, and first-DM privacy lifecycle have
been verified.
