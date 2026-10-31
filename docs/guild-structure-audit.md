# Guild structure and permission audit events (#61)

**Status: source-only, disabled by default.** This PR is stacked on
[#104](https://github.com/norshimself/Yuugen/pull/104) for issue #60.
Its base is \`feat/60-configurable-audit-log\`, not \`main\`.
**Do not apply this migration or enable structural auditing before #104 is
reviewed, merged, and its staging migration has succeeded.**

## Source of truth and privacy

All structural signals come from Discord's actual
\`guildAuditLogEntryCreate\` gateway event, not from matching timestamps
with role/channel/webhook gateway events. The event needs
\`ENABLE_GUILD_MODERATION_INTENT=true\` and the bot's **View Audit Log**
permission. Guild Moderation is nonprivileged. The bot explicitly checks
that permission at observation time and the manager configuration API
checks it before enabling a structural selection.

Only metadata is persisted: guild ID, Discord audit-entry ID, bounded
event type, validated target/source IDs where exposed, actual audit
\`executorId\` when available, server event timestamp, delivery outcome,
and **up to 12 fixed, allowlisted changed-field names**. We never store or
send audit-log \`reason\`, channel names/topics, role names, webhook
tokens/URLs, nickname text, user-provided values, raw permission bitmasks
or before/after field snapshots. Webhook channel/actor information is not
guessed if absent. The bot's own entries are suppressed only when its
actual executor ID is present; unknown actors remain unknown.

## New selectable events

Each type is selected independently via the issue #60 manager-only
\`POST /api/v1/audit\` configuration endpoint:

| Kind | Discord audit action(s) |
| --- | --- |
| \`role_create\`, \`role_delete\` | RoleCreate, RoleDelete |
| \`role_update\` | RoleUpdate with changed safe role fields, excluding permission-only changes |
| \`member_role_update\` | MemberRoleUpdate with a nonempty role addition or removal |
| \`channel_create\`, \`channel_delete\` | ChannelCreate, ChannelDelete |
| \`channel_update\` | ChannelUpdate with supported changed fields |
| \`webhook_create\`, \`webhook_delete\` | WebhookCreate, WebhookDelete |
| \`webhook_update\` | WebhookUpdate with supported changed fields |
| \`permission_change\` | RoleUpdate permission bit change, channel permission-overwrite create/update/delete, and ChannelUpdate overwrite changes where Discord supplies a before/after delta |

Permission classifications are **actual changes**, not necessarily
malicious escalations: selecting \`permission_change\` records legitimate
grants, removals and revocations too. Unlike #59's anti-nuke detector,
this is an administrator-facing change audit, not an intrusion score.
Ambiguous or missing before/after permission snapshots are skipped
rather than guessed. Audit fields might be absent or incomplete; lack
of an audit event does not prove an operation never occurred.

The log summary includes event kind, trusted numeric IDs, optional
trusted executor ID and a short list of static field names such as
\`permissions\`, \`name\`, \`roles_added\`, or \`deny\`. It contains **no**
free-text values and sends \`allowedMentions: { parse: [] }\`.

## Configurable retention

The \`GuildAuditConfig\` API accepts optional \`retentionDays\`, a safe
integer **1–30**, with a default of **7 days** for existing #60 requests.
For example, after #60 is staged:

\`\`\`json
{
  "guildId": "123456789012345678",
  "settings": {
    "enabled": false,
    "logChannelId": null,
    "selectedEvents": ["role_create", "role_delete", "permission_change"],
    "retentionDays": 3
  }
}
\`\`\`

To enable, select a **private** guild text destination that the bot can
View Channel + Send Messages in, and that \`@everyone\` cannot view.
Existing JWT + GuildAccessGuard **Manage Server** checks remain intact.
The runtime rechecks configuration and permissions before each send.
Turning auditing off never requires a surviving destination channel.

Manager history queries filter out rows older than the configured retention
window, even if physical deletion has not yet run.

Retention is **best-effort**: the existing service prunes expired rows
only when it processes a new eligible guild event (at most once per ten
minutes per worker). Quiet/disabled guilds require an external
retention cleanup until durable scheduler/privacy work (#90/#91)
is implemented. \`retentionDays\` is not a guarantee of deletion on the
exact expiry date. Discord's independently retained messages in the
staff channel must be managed under the guild's own channel retention
and privacy processes; deleting database metadata does not delete
those messages.

## Ordering, idempotency and limits

- **Delayed and out-of-order** structural audit events are accepted up
  to ten minutes after Discord's \`createdTimestamp\`, versus two minutes
  for the #60 message/member gateway observations. Future timestamps
  over five seconds are rejected.
- A stable \`eventType:auditEntryId:0\` key and the #60 PostgreSQL unique
  constraint deduplicate replays/reconnects across bot workers.
- Existing #60 **20 events/minute/guild** database delivery slots apply
  to *all* selected audit types, not 20 additional structural events.
  Overloaded guilds will have omitted events rather than unbounded
  API usage; this is not a lossless security or forensic record.
- The event and delivery timestamp are stored separately. Delayed
  entries are sent in their **arrival order**, not guaranteed historical
  timestamp order; history exposes the event timestamps for review.
- Rows are reserved \`pending\` before any Discord API send.
  Missing permissions or changed settings become \`failed\`, ambiguous
  network delivery remains \`pending\`, with no blind retry.
- Channel changes to the configured log destination are skipped; the
  bot's own audited changes are skipped when the executor ID is
  authoritative. Other changes never cause mutations or rollback.

## Manual staging verification

1. Review and merge #104. Back up **staging** PostgreSQL. First apply
   \`20261029_guild_audit_channels.sql\`, then apply
   \`backend/migrations/20261029_guild_audit_structure.sql\`. Confirm
   \`retentionDays\`, \`changedFields\` columns and the expanded
   \`CHK_guild_audit_type\` constraint. Never enable TypeORM schema sync
   in production.
2. Run \`npm ci && npm run build && npm test -- --runInBand &&
   npm run test:e2e -- --runInBand\` in \`backend/\` with dependencies
   available. GitHub Actions remain disabled.
3. Use a disposable Discord guild and private audit channel. Enable
   \`ENABLE_GUILD_MODERATION_INTENT=true\`, grant bot **View Audit Log**,
   and verify nonmanagers cannot view or change settings/history.
4. Select one type at a time. Create/update/delete disposable roles,
   channels, webhooks, update member roles with consenting testers,
   grant/revoke permission bits and edit channel overwrites. Check
   classification, matching numeric IDs, static field names, absence
   of raw field values, and empty allowed-mentions.
5. Verify skipped no-op changes, missing/invalid permission snapshots,
   missing executor IDs, bot-origin changes, deleted/renamed log
   destination, missing View Audit Log and bot Send Messages access,
   config disable races and privacy under unknown/staff role overwrites.
6. Replay an actual audit entry ID and deliver a ten-minute-delayed
   event, then exceed the 20/minute per-guild cap across two workers.
   Check rate-bound omissions and ordering without duplicate sends.
7. Test retention setting boundaries (1, 7, 30), confirm metadata prune
   on new events and plan reliable cleanup for quiet guilds.
8. Disable all guild audit rules after testing. Do not deploy to
   production until security/privacy review, full tests and staging
   sign-off are complete.

**Rollback:** Disable any selected structural event types before
returning to #60 code. Keep the expanded SQL schema until records
have been exported/deleted under approved retention processes.
Do not drop data or mutate live guild permissions without review.

**Issue #61 remains open** until actual Discord and staging acceptance,
reliable retention and operational sign-off are complete.
No GitHub Actions were re-enabled and no database migration, production
deployment or live Discord operation was performed by this PR.


**Independent activation:** structural and basic audit listeners both require
`ENABLE_GUILD_AUDIT_LOGGING=true`, in addition to the optional Guild Moderation
intent. The switch defaults false on the merged #60 foundation. Enable only
after both audit SQL migrations and disposable privacy/permission acceptance.
