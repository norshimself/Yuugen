# Privacy inventory, data exports and retention — issue #91

**Status:** First source-only implementation, based on `main`. It covers the
current database schema, not every unmerged feature branch. No production
database, Discord API or deployment has been mutated. GitHub Actions stay off.

## Data inventory and proposed policies

| Dataset | Information stored | Retention and access |
| --- | --- | --- |
| `sessions` | Discord user ID, server-side refresh session **token ID**, one-use OAuth code SHA-256 digest, creation and expiration | Login grant: 2 minutes; refresh session: 7 days. Delete when expired via existing auth cleanup or optional retention worker. Self-erasure deletes all of the actor's sessions. **Never export raw session IDs.** |
| `user_profiles` | Discord user ID, globally shared XP, coin/bank balances, inventory, cooldown dates | Global **across guilds**. No automatic TTL; self-export and explicitly confirmed self-erasure only. |
| `trivia_sessions` | Discord user ID, question/message ID, correct answer, reward, creation date | Game expires after 15 minutes. Incremental TTL cleanup; explicit self-erasure. |
| `trivia_questions`, `shop_items` | Shared trivia and shop catalog data | Not personal; not removed for an individual user. |
| `guild_settings` | Guild ID, welcome text/channel, prefix, word blacklist, moderation toggles | Live Manage Server permission required for guild export. Deletion needs guild lifecycle/cache review. |
| `automod_rules` | Guild ID, blocked phrases, exemptions, rule settings | Manager-only export, limited to 100 rules with truncation notice; deletion not yet approved. |
| `moderation_cases` | Guild, target/staff IDs, case actions, **free-text reasons**, timestamps | Required audit/appeal evidence. Separate privacy/legal retention and subject-access review. Not erased by a self-request. |
| `moderation_purges` | Guild, actor/filter IDs, **message IDs** and free-text reasons, event counts/status | Audit metadata; no copied message text or attachments. Separate retention review. |
| `moderation_channel_locks`, `moderation_voice_cases` | Guild, staff and target IDs, channel IDs, permission snapshots, reasons, timestamps | Separate audit/legal policy; preserved. |
| Gateway message activity/AutoMod counters | Guild/member IDs and matching content inspected in memory | Bounded in-memory only; Message Content intent is opt-in. No new transcript storage. |
| OAuth and service secrets | Discord bot/client secrets, JWT secret, Lavalink/DB credentials | Deployment environment, **not** in this PR's exports. Require secret rotation, restricted access, encrypted backups and TLS review. |

**Unmerged feature data needs a second inventory before integration.** Other
draft branches contain onboarding DM/acknowledgement receipts (#62), anti-raid
join metadata (#58), audit event records (#60/#61), and scheduled jobs/journal
(#90). Ticket conversations, transcripts, provider attachments and personal
consent settings need their own documented storage/export/retention decisions
before they are enabled. Do not assume this PR erases any of those datasets.

## Available privacy API (first slice)

All endpoints return `Cache-Control: no-store`. Signed-in self operations take
their user ID from JWT authentication, never from URL parameters or JSON input.

- `GET /api/v1/privacy/me/export`: exports the caller's *existing* global
  economy profile and trivia metadata without creating a new profile.
  Includes the latest **50** auth session creation/expiration timestamps,
  total session count and an explicit truncation indicator. Session IDs, JWTs,
  OAuth grants and future entity columns are excluded by fixed allowlists.
  Moderation history, other guild records and unmerged datasets are explicitly
  **not covered**. This is a partial export, not a claim of complete subject
  access.
- `POST /api/v1/privacy/me/erase`: requires the signed-in user's JWT,
  trusted first-party JSON headers/origin, and *exactly*:
  `{"confirmation":"ERASE_MY_YUUGEN_DATA","scope":"global_economy_and_ephemeral_auth"}`.
  A single transaction deletes this user ID's rows from `trivia_sessions`,
  `user_profiles` and `sessions`. No target-user ID can be supplied. Repeating
  the request returns zero rows, and the auth refresh cookie clears **only
  after commit**. It does **not** erase moderation/audit/legal records,
  guild settings, third-party/Discord data, or retained backups.
  Existing stateless bearer JWTs may remain usable for up to **15 minutes**;
  a new Discord bot interaction can create a fresh economy profile. Global
  economy deletion resets the user's data in every guild.
- `GET /api/v1/privacy/guild/export?guildId=...`: protected by JWT and fresh
  GuildAccessGuard membership with Manage Server permission in the requested
  guild. Exports only the existing guild settings and first 100 AutoMod rule
  configurations. `truncated=true` flags further pages needing a reviewed
  export flow. Does not expose user profiles, members of other guilds, or
  moderation cases. No guild-wide erase endpoint is offered yet.

**Do not treat these as a complete legal rights workflow.** Sensitive
moderation evidence and third-party identifiers require independent access,
legal hold, redaction and deletion decisions. No bulk moderator export,
unbounded download, arbitrary staff deletion, or cross-guild endpoint is added.

## Expiration cleanup

`ENABLE_PRIVACY_RETENTION_WORKER=false` is the shipped default. After
disposable-PostgreSQL acceptance it may be enabled in staging. It runs an
immediate sweep and then every **30 minutes**, at most one in-flight sweep per
process. Each statement deletes at most **250** expired auth sessions or trivia
records older than **15 minutes**, using PostgreSQL `clock_timestamp()` and
`FOR UPDATE SKIP LOCKED`. Overlapping workers cannot select the same row.
Only aggregate record counts are returned/logged; session IDs are not.
More expired records wait for the next bounded sweep. No moderation or guild
audit table is ever targeted by the worker.

## Outstanding review blockers

1. Encryption-at-rest for live databases and snapshots, transport TLS, vault
   permissions, secret rotation, logging redaction and safe session-token
   hashing/rotation need deployment/security verification. This source PR
   **does not implement encryption** or change existing session token storage.
2. Moderation audit evidence, transcript storage, consent for privileged
   Discord intents, subject-access redaction and legal hold periods need
   module-by-module policy sign-off before generalized erasure.
3. Guild removal requires cache invalidation, stopping live bot behavior,
   handling active moderation state, separately retaining needed audit traces
   and verifying the requester has ongoing guild authority. No unreviewed
   bulk guild delete is authorized.
4. Stateless JWT access persists up to 15 minutes after sessions are removed.
   Full immediate revocation requires a separate per-user revocation design.
5. Backup expiration and Discord/provider-held records have separate
   retention/erasure controls and are not changed here.
6. A large guild's AutoMod export or a user's session-history export can be
   truncated; complete pagination and additional feature data remain future
   work.

## Disposable staging acceptance and rollback

1. Install real NestJS dependencies, run backend build/Jest/e2e and frontend
   compatibility checks. No GitHub Actions re-enablement.
2. On a disposable PostgreSQL instance, create **two users and two guilds**,
   unique profiles, auth sessions, trivia sessions and guild settings/rules.
   Verify user A never reads/deletes B, and manager A never reads guild B.
3. Test expired/invalid JWT, demo identity, lost Guild Members permissions,
   lost Manage Server rights, forged guild ID, invalid JSON bodies, malicious
   additional body fields, wrong confirmation and cross-origin requests.
4. Commit and roll back simulated partial erasure transactions; verify
   repeated erasure is idempotent and moderator records, other users,
   guild settings and required audit are preserved. Test the 15-minute
   residual JWT window and profile re-creation on later Discord activity.
5. Enable the TTL worker **only in disposable staging**. Insert expired and
   fresh session/trivia rows; race two workers, assert 250-row bounds and
   no accidental deletion of fresh records or logging of token material.
6. Review backup and restore separately, ensure no automatic restoration of
   previously erased data without a legal basis, and seek privacy/security
   sign-off before release.

**Rollback:** Keep the retention flag false; remove the privacy module/routes
to disable access without applying any migration. A code rollback cannot
restore data already deliberately erased; restoring such data requires an
explicitly reviewed backup recovery decision. Keep #91 open until complete
data inventories, consent, audit retention, large exports and legal review
are addressed.
