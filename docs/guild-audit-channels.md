# Guild member and message audit channels (#60)

**Implementation status: source-only; disabled for every guild until explicitly
configured and accepted on staging.** GitHub Actions remain disabled.

## Purpose and privacy contract

Guild managers can select which audit events to send to a *private* guild text
channel. **No message content, before/after message diff, attachment content,
reason text, message URLs, usernames, or user-supplied text is fetched,
retained or sent by this module.** Only Discord-provided IDs, event type,
time, and delivery status are stored. Outbound Discord messages use
\`allowedMentions: { parse: [] }\` so logged IDs never ping users.

Since message content is not accessed, **Message Content privileged intent is
not required** for metadata-only message edit/delete logging. Members and
moderation signals have separate gateway requirements below.

## Configuration and selection

All routes require the existing JWT and live Discord guild membership with
**Manage Server** via \`GuildAccessGuard\`:

- \`GET /api/v1/audit?guildId=GUILD_ID\`: configuration.
- \`POST /api/v1/audit\`: a full \`{ "guildId": "...", "settings": {...} }\`
  object, validated against an explicit allowlist.
- \`GET /api/v1/audit/history?guildId=GUILD_ID\`: last 30 metadata-only
  event records and delivery states for staff reconciliation.

Start with:

\`\`\`json
{
  "enabled": false,
  "logChannelId": null,
  "selectedEvents": []
}
\`\`\`

Supported event kinds: \`message_edit\`, \`message_delete\`, \`member_join\`,
\`member_departure\`, \`member_ban\`, \`member_kick\`,
\`member_timeout\`. Each must be selected explicitly and cannot be
duplicated in configuration. A selected event type does not automatically
enable any other kind. Enable only with a guild text channel that the
bot can **View Channel + Send Messages** in and where **@everyone does
not have View Channel**. Staff should independently review any extra
overwrites/roles that could still expose audit IDs to nonstaff. The
runtime rechecks channel type, @everyone visibility, and bot permissions
before each send. **Disable is always allowed**, even after a channel
is removed or permissions change.

## Event behavior and limitations

- Message edits: record the message ID and source-channel ID only if
  Discord supplies an edit timestamp; ignore webhook/bot messages.
  Replays of the same \`messageId + editedTimestamp\` are deduplicated.
- Message deletions: record message ID and channel ID, even for partial
  uncached messages that have no author/content information. Do not
  guess the deleter. Bot/webhook messages with known authors are skipped,
  and destination-channel messages are always skipped to avoid recursion.
  Bulk-delete gateway events are handled with a **20-message maximum fanout**;
  further deletions in the bulk batch are intentionally omitted.
- Member joins and departures: require
  \`ENABLE_GUILD_MEMBERS_INTENT=true\` and the privileged Guild Members
  intent enabled in Discord Developer Portal. \`member_departure\` is
  deliberately **not** called a voluntary leave or a kick: it may
  correspond to a leave, kick, or ban and has no trusted actor.
- Timeouts: Guild Members intent is required. Observe when Discord
  exposes a changed communication-disabled-until timestamp; never
  claim to know the moderator from adjacent events.
- Bans: require \`ENABLE_GUILD_MODERATION_INTENT=true\` for the
  \`guildBanAdd\` event. No moderator actor is inferred.
- Kicks: require the same Guild Moderation intent **and** the bot
  permission **View Audit Log**. Only an actual Discord
  \`guildAuditLogEntryCreate\` with \`MemberKick\` can be labeled a kick.
  Its \`executorId\` is stored as actor only if Discord supplies it.
  The \`guildMemberRemove\` event is never treated as kick confirmation.

The Guild Moderation gateway flag is **not privileged** but it is off
in the checked-in configuration by default. Guild Members is privileged.
Neither of these settings may be silently enabled by an HTTP call; the
server must be restarted with appropriate environment flags and
Discord developer portal intents where required.

## Persistence, deduplication and rate limits

\`guild_audit_configs\` is per-guild and disabled by default.
\`guild_audit_events\` stores only event identifiers/metadata and one
delivery state: \`pending\`, \`sent\`, or \`failed\`.

PostgreSQL unique indexes on \`(guildId, eventKey)\` and
\`(guildId, minuteBucket, slot)\` enforce replay safety and **at most
20 audit deliveries reserved per minute per guild**, even with multiple
backend workers. Busy guilds may omit events after the cap. Concurrency
may also drop a contended event without retry; logging is not a
lossless forensic record. A timestamp older than two minutes (or over
five seconds in the future) is ignored. A repeat ban in the same minute
and a rapid leave/rejoin without complete timestamps can share a
deduplication key: this is intentional bounded behavior, not proof
that the underlying event did not occur.

An audit row is reserved as \`pending\` before sending the Discord
message. Known permission failures and configuration changes become
\`failed\`. Uncertain network results remain \`pending\` for human
review: the send may already have succeeded, so there is **no automatic
retry**. New events opportunistically delete stored audit metadata
older than **seven days**, once per ten minutes per active guild.
Quiet or disabled guilds are **not automatically pruned on schedule**;
durable cleanup, retention controls and export/delete mechanisms remain
dependencies (#90 and #91). This is not yet a production-complete
audit-retention policy.

## Manual release acceptance (disposable guild only)

1. Back up PostgreSQL. Apply prior required migrations first and then
   \`backend/migrations/20261029_guild_audit_channels.sql\` to **staging**.
   Confirm no guild starts enabled and unique indexes exist.
2. Run \`npm ci && npm run build && npm test -- --runInBand\` and
   \`npm run test:e2e -- --runInBand\` from \`backend/\`.
   Keep GitHub Actions disabled.
3. Create a private test channel accessible only to consenting staff
   and Yuugen. Verify a public channel and a channel without bot
   Send Messages permission are rejected. Verify a nonmanager account
   cannot read or update settings/history.
4. Enable only message metadata, without Message Content intent.
   Edit/delete messages, replay the same events and test uncached
   deletion, partial information, bot/webhook exclusions and audit
   channel recursion. Verify no message text appears in database
   rows or Discord alerts.
5. Enable Guild Members intent to exercise join, departure and timeout
   change with consenting test users. Verify the departure is not
   falsely attributed to a kick and that disabling the intent blocks
   corresponding configuration.
6. Enable Guild Moderation to test ban logging and actual
   \`MemberKick\` audit-log delivery. Remove bot View Audit Log,
   verify kick configuration and runtime checks fail closed.
7. Test 20/minute cap, unique event replay after process restart,
   two-worker contention, missing channel/perms, changed settings
   during delivery, ambiguous Discord send outcomes, and manager-only
   audit history.
8. **Turn off all selected logging** after testing. No production
   release without privacy/retention and complete staging sign-off.

Rollback: disable each guild's configuration **before** restoring older
application code; additive tables may be retained until privacy/legal
retention requirements are fulfilled. Do not drop audit data without
approved export/purge procedure.

No live Discord moderation, schema migrations, deployment, or GitHub
Actions workflow execution is part of this PR. Keep issue #60 open
until full build, staging acceptance and retention guarantees are met.
