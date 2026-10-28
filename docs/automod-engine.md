# AutoMod rule engine (issue #56)

The AutoMod engine is opt-in and per Discord guild. There are no enabled rules
after database migration. The bot requires ENABLE_MESSAGE_CONTENT_INTENT=true
and the privileged Message Content intent enabled in the Discord Developer
Portal to evaluate content-related rules.

## Rule configuration

Authenticated guild managers (Manage Server) use:

- GET /api/v1/automod?guildId=<guild ID> to inspect up to 50 rules
- POST /api/v1/automod/rules with guildId and a rule object
- POST /api/v1/automod/rules/<id>/enabled with guildId and enabled boolean

Rules have name, enabled, priority (0-10000), kind (blocked_phrases or
message_rate), action (dry_run or delete), phrases, threshold, windowSeconds,
exemptChannelIds and exemptRoleIds. Rules are limited to 50 per guild.
Phrases use Unicode NFKC normalization and full-word matching. Arbitrary
regular expressions are deliberately unsupported to avoid regex denial of
service. Thresholds are 2-20 messages across a configurable 2-60 second
window. Matching stops at the first rule in priority/ID order. Exempt
channels and roles always bypass that rule.

Start all rules in disabled + dry_run mode. Explicitly enable and inspect
server logs before selecting delete. Dry-run does **not** change messages;
it emits a rate-limited summary with guild/rule ID and no message content.

## Safety and limitations

- Bot/webhook events and DMs are ignored; there is no content logging.
- If Message Content intent is disabled, the listener returns before evaluation.
- If member role exemptions cannot be verified, the listener fails closed.
- In-memory message windows and deduplication are bounded and reset after
  restart. This is per-process, not multi-worker consistency; test before
  deploying multiple bot processes.
- Discord message deletion is never automatically retried.
- No warning, timeout, or ban action is taken by this engine yet. Follow-on
  rules/actions belong to issue #57.
- Message-event evaluation has no production rollout approval from the PR.

## Migration and staging

After a PostgreSQL backup and existing moderation migrations (including
20261028_moderation_voice.sql), apply:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261028_automod_rules.sql
```

The migration creates automod_rules and does not enable any rule.

Before release: run backend build, Jest/e2e and inspect Discord command
registration. In a disposable guild, verify the manager-only API, roles and
channel exceptions, disabled rules, Unicode matching, spam thresholds,
duplicate event protection, missing privileged intent, dry-run no-deletion,
and delete permissions. Confirm errors do not delete messages or award
unintended punishments. GitHub Actions remain disabled.

This work is source only, not a production deployment or migration.
