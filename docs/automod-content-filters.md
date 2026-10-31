# AutoMod content filters (#57): staging-only rollout

This extends the opt-in per-guild AutoMod rule API from issue #56.
Use kind `invite_link`, `external_link`, `mass_mentions`,
`attachment_rate` or `repeated_content`. Existing authentication and
Manage Guild checks apply. No new rule is created or enabled by this change.
Actions remain `dry_run` or `delete` only: **warn/timeout are deferred**
until an explicit, durable action audit path is designed.

New JSON properties on rule creation:
- `allowedDomains`: at most 50 DNS hostname values. Entries match the
  exact hostname and its subdomains; never arbitrary substrings.
- `allowedInviteCodes`: at most 50 Discord invite codes, case-sensitive.
- `threshold`: 2–20 for mass mentions and repeated-content messages,
  1–20 for attachment count. `windowSeconds`: 2–60.
  Link rules ignore threshold/window but still require valid bounded values.

`invite_link` matches normal Discord invite URLs only, not a bare mention
of Discord. `external_link` matches explicit HTTP(S), www and Discord invite
URLs; bare domains and ordinary email addresses are not matched. Unicode
NFKC and URL parsing help prevent confusable and userinfo-host bypasses.
Allowlisted hosts are trusted, so configure them sparingly. The bot does not
classify remote website reputation or inspect attachment bytes.

Mention counts use actual Discord user/role mentions and @everyone/@here.
Attachments are counted per guild/member over the rule's window;
repeated-content uses a non-reversible SHA-256 digest of NFKC normalized
message content, never stored plaintext, for 8+ character messages. Windows
are bounded in process memory and reset on restart. They are NOT consistent
across multiple bot workers. No event is deleted without an explicit,
enabled per-guild delete rule and the bot's existing delete permission check.
Message Content privileged intent remains disabled by default.

## Migration, manual checks and rollback

Back up staging PostgreSQL, apply
`backend/migrations/20261028_automod_rules.sql` first, then
`backend/migrations/20261028_automod_content_filters.sql`. Restart backend
only after staging migration and TypeScript/Jest/e2e checks. Use a disposable
Discord guild with consenting test users. Verify disabled rule, dry-run
never deletes, allowed domain/subdomain, userinfo/suffix spoof, invalid URLs,
role/channel exemption, duplicate events, attachments, mention counts,
repeated messages, missing intent, missing permissions and reconnect reset.
Review false positives before enabling deletion. Keep GitHub Actions disabled.

To roll back application logic, disable new-kind rules before returning
to old source code; keep additive columns and the expanded kind constraint
until data has been migrated. Do not drop live rule data without a backup.

No deployment, production data migration, or live Discord moderation was
performed in this PR.
