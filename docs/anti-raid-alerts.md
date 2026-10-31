# Anti-raid join-rate detection — opt-in alert-only slice (#58)

**Source-only, no production rollout.** This PR does not add quarantine, kicks,
bans, or automatic permissions changes. It is intentionally safe for legitimate
high-volume onboarding events and requires manual staff review.

## API and rules

All endpoints have JWT authentication, Discord guild-bound verification and
**Manage Server** permission checks via the existing GuildAccessGuard.

- GET \`/api/v1/anti-raid?guildId=GUILD_ID\`: read configuration.
- POST \`/api/v1/anti-raid\`: submit \`{"guildId":"...","settings":{...}}\`.
- GET \`/api/v1/anti-raid/alerts?guildId=GUILD_ID\`: last 20 metadata-only
  alerts, including delivery and human review status.
- POST \`/api/v1/anti-raid/alerts/ID/review\`: submit
  \`{"guildId":"...","disposition":"legitimate"}\` or \`"suspicious"\`
  to record a single staff disposition. This changes *no* member roles and
  never automatically overrides future alerts; change explicit exemptions
  in settings when appropriate.

The complete \`settings\` object is required on POST:

\`\`\`json
{
  "enabled": false,
  "mode": "alert_only",
  "threshold": 10,
  "windowSeconds": 60,
  "minAccountAgeMinutes": 1440,
  "alertChannelId": null,
  "exemptUserIds": [],
  "exemptRoleIds": []
}
\`\`\`

Threshold is 3–100 joins; the sliding window is 10–600 seconds; minimum
account age is 0–43,200 minutes. By default, a spike alerts **only when the
latest joining account is younger than 24 hours**. Set minimum age to 0 only
when you deliberately want rate-only alerts (including legitimate join waves).
All rules are per guild. The current event and all counted events must be
nonexempt. Role/user exemptions are bounded to 50 IDs each.

When enabled, a writable guild text channel is required. The web API checks
the bot's View Channel/Send Messages permissions when saving. The listener
checks them again at event time. Alerts contain an aggregated count, time
window and configured account-age criterion only, with all Discord mentions
disabled. No user IDs or chat contents appear in alert messages. The metadata
audit is manager-readable and stores guild, time bucket, count, status and
optional reviewer identity/disposition.

## Persistence, idempotency and limits

A verified \`guildMemberAdd\` with a non-null Discord join timestamp is saved
as a metadata-only \`anti_raid_joins\` row **after** checking config,
exemptions and a current event window. The unique
(guildId, userId, joinedAt) key ignores duplicate gateway events, even after
restart. A DB count over recent joins tracks a sliding window across bot
workers. A unique (guildId, five-minute bucket start) alert reservation
ensures at most one dispatch in each bucket across workers. Two alerts can
occur near a bucket boundary. An alert audit is created as \`pending\`
*before* the Discord API request. Known missing permissions finalize as
\`failed\`; ambiguous network errors remain \`pending\` for staff review.
No automatic delivery retries or role mutations occur.

Event retention is **best-effort**, cleaned on new eligible joins: rows older
than one hour and alert audits older than 30 days are deleted for that guild
at most once per five minutes per worker. Quiet/disabled guilds require
operator cleanup until durable scheduler and privacy work (#90/#91).
Back up or export audit data needed for support before cleanup. Do not use
this as a complete audit logging/reconciliation platform.

Guild Members is a **privileged Discord gateway intent**. Enable
\`ENABLE_GUILD_MEMBERS_INTENT=true\` and authorize it in the Discord Developer
Portal for staging, otherwise this listener silently does nothing. Intent is
off by default. There is no dependency on Message Content intent.

## Staging migration and acceptance

1. Back up PostgreSQL and apply previous moderation/AutoMod migrations before
   \`backend/migrations/20261028_anti_raid_alerts.sql\` in staging.
2. Run backend TypeScript build, Jest tests, e2e tests locally, and verify
   database constraints/indexes in staging; GitHub Actions must remain disabled.
3. Start a disposable guild, create a private mod-only text channel with the
   bot's View Channel/Send Messages permissions, then configure disabled settings
   through a Manage Server account. Verify nonmanager access is rejected.
4. Enable with a modest **dry alert-only** rate, have consenting users join,
   verify count, age boundary, role/user exemptions, no pings, one alert
   bucket, repeated/replayed event dedupe and restart behavior.
5. Revoke bot send access mid-session, ensure a failed audit and no unsafe
   fallback. Exercise network response ambiguity and manual review endpoint.
6. Validate normal older-account join waves and verify the bot never gives a
   role, timeout, ban or kick. Disable the feature after testing.

Rollback: disable anti-raid in every configured staging guild before returning
to an older backend; retain the additive tables until a reviewed privacy export
or purge has been performed. No PostgreSQL migration or live Discord action was
executed by this PR.

**Deferred acceptance:** safe reversible quarantine role assignment, staff
release/override, role hierarchy and privilege checks, manual sign-off and
reliable retention jobs need separate implementation/review. Keep #58 open.
