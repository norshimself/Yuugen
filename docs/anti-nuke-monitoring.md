# Anti-nuke audited event monitoring — alert-only implementation (#59)

**Status: source-only, disabled by default.** This first slice monitors
destructive Discord audit-log entries and asks moderators to review them.
It **does not** perform emergency lockdown, ban/kick/timeout members,
change role permissions, or attempt automated recovery.

## What qualifies

The listener consumes Discord's \`guildAuditLogEntryCreate\` event (not
timestamps guessed from nearby channel/role gateway events):

- \`ChannelDelete\`, \`RoleDelete\` and \`WebhookDelete\` audit entries.
- \`RoleUpdate\` only if the *old and new* permission bitfields show a new
  Administrator, Kick Members, Ban Members, Manage Channels, Manage Guild,
  Manage Messages, Manage Roles, Manage Webhooks, or Moderate Members grant.
- \`ChannelOverwriteCreate\` for newly allowed critical privileges and
  \`ChannelOverwriteUpdate\` for critical privilege grants or removal of an
  explicit critical deny; both require verifiable before/after data.

Normal role name/color edits, webhook creations, permission reductions,
unparseable permission changes and ordinary channel changes do not count.
This is deliberately conservative; a gateway update with no corresponding
audit entry or a delayed/ambiguous audit record may go unobserved.
No actor is inferred by comparing timestamps. If Discord supplies
\`executorId\`, it is the audit actor; otherwise the actor remains null
and cannot match an exemption.

## Admin controls

All endpoints use the existing JWT and live Discord \`Manage Server\`
guard, scoped to the requested guild:

- \`GET /api/v1/anti-nuke?guildId=GUILD_ID\`: read settings.
- \`POST /api/v1/anti-nuke\`: submit \`{ "guildId": "...", "settings": {...} }\`.
- \`GET /api/v1/anti-nuke/alerts?guildId=GUILD_ID\`: recent 20 audit
  alerts, including pending/sent/failed status and human review.
- \`POST /api/v1/anti-nuke/alerts/ID/review\` with
  \`{ "guildId": "...", "disposition": "legitimate" }\` or
  \`"suspicious"\` to add a *single* staff disposition. This never takes
  action against the supposed actor or changes future alert policy.

Complete settings required on update:

\`\`\`json
{
  "enabled": false,
  "mode": "alert_only",
  "threshold": 3,
  "windowSeconds": 60,
  "alertChannelId": null,
  "exemptActorIds": []
}
\`\`\`

Set threshold to 3–30 audited events and sliding window to 10–600 seconds.
Specify a guild text channel the bot can view and send to before enabling.
At most 50 exemption IDs can be supplied. Those IDs apply to **verified**
audit executors only. Unknown executors are neither guessed nor exempted.
Exempt only known legitimate administrative actors after review, not a
broad role. The settings cache is five seconds per worker and may briefly
lag changes; no punitive actions are available.

## Gateway, database and rate control

Discord's **Guild Moderation** gateway intent is optional and disabled
by default. For a disposable test guild, set
\`ENABLE_GUILD_MODERATION_INTENT=true\`; ensure the bot also has
**View Audit Log**. The listener will skip events without that permission.
No Message Content or Guild Members intent is required by this module.

Only recent (30-second age) accepted audit events are persisted to
\`anti_nuke_events\`. The unique (guildId, auditEntryId) index protects
against replay and concurrent bot workers. Events store only guild ID,
audit entry ID, event kind, optional target/actor IDs and timestamp: no
message content, channel names or permission snapshots. Threshold
evaluation counts all nonexempt qualifying events in PostgreSQL, so
joins in multiple workers share the sliding window.

One alert is reserved per guild per five-minute UTC time bucket, with a
database uniqueness index. Bursts that straddle a bucket boundary may
generate two alerts. Before any Discord send, a pending audit is saved.
The bot sends an aggregated, no-mentions summary with the event count,
window and latest kind. A known channel or permission failure is stored
as failed; network ambiguity remains pending to avoid duplicate sends.
Human review is required; a pending record may mean **sent but unconfirmed**.

Older event metadata (one hour) and alert audits (30 days) are pruned
opportunistically on newly accepted observations, no more than once per
five minutes per guild per worker. Quiet guild retention and deletion
are still pending #90/#91, so audit/log data should not be assumed to
expire precisely. Any future broad deployment requires a privacy review.

## Manual verification before release

1. Back up **staging** PostgreSQL. Apply all prior required migrations,
   then \`backend/migrations/20261028_anti_nuke_monitoring.sql\`.
   Validate constraints and unique indexes in staging.
2. Run backend TypeScript/NestJS build, Jest and e2e with dependencies
   installed. Do **not** re-enable GitHub Actions.
3. In a **disposable Discord guild**, enable Guild Moderation intent,
   give the bot View Audit Log, create a private staff alert text
   channel, and verify JWT/Manage Server access and input validation.
4. Start disabled. Confirm real channel/role changes produce no alerts.
   Enable alert-only and simulate a bounded series of channel/role
   deletions, webhook deletions, a privileged role permission gain and
   a channel overwrite change. Verify ordinary edits and webhook creation
   do not count. Use disposable roles/channels and consenting staff only.
5. Verify threshold/time-window boundaries, unknown actor handling,
   allowlisted audit executors, replaying the same audit entry,
   concurrency across two workers, and five-minute bucket boundaries.
6. Revoke View Audit Log or alert-channel Send Messages, check safe
   no-action behavior and failure status. Exercise network ambiguity,
   a single manual review and the manager-only alert history.
7. Verify there is no role overwrite, server-wide lockdown, member ban,
   kick or timeout. Disable feature after testing.

**Rollback:** Disable enabled anti-nuke settings first, then deploy the
previous code. The additive migration is safe to leave in place; do not
drop event or audit tables until the operator has exported/retained data
as required by the project's privacy policy. No migration, Discord
mutation, deployment or GitHub Actions run was performed by this PR.

## Remaining issue #59 scope

A genuine emergency lockdown must be a *separate reviewed change* with
Administrator-level confirmation (not just Manage Server), narrowly
defined affected resources, persisted original overwrite/role
snapshots, safe conditional restoration, distributed concurrency
control and a rate-limited recovery path. Dependent guild audit logging
and configuration backup work is incomplete. **Keep issue #59 open.**
