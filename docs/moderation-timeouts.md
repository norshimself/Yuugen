# Yuugen: timeout and remove-timeout moderation (issue #52)

This adds two protected Discord moderation subcommands to the existing
`/mod` group, with confirmation and persistent guild-scoped case history.

## Commands

- `/mod timeout user:<member> duration:<10m|2h|7d> reason:<text>` —
  temporarily prevent a member from communicating in the server.
- `/mod untimeout user:<member> reason:<text>` — remove a current timeout.
- `/mod cases user:<member>` or `/mod cases user_id:<id>` —
  show past moderation cases, including timeout outcomes and the approximate
  planned end time.

Supported timeout durations are **1 minute to 28 days inclusive**: whole
numbers followed by `m` (minutes), `h` (hours) or `d` (days).
Examples: `10m`, `2h`, `1d`, `28d`. Fractions, zero, negative values,
units such as `w`, and durations longer than 28 days are rejected.
Discord automatically expires a timeout; **Yuugen does not schedule an
automatic untimeout job** for this feature.

If a member already has an active timeout, this command refuses to overwrite
it. Remove the old timeout before setting a replacement. Likewise, untimeout
only works on a member who is currently timed out, and does not change
past timeout cases.

## Authorization and confirmation

- **Both** the acting moderator and bot must have **Moderate Members**.
- The target must be a current guild member; the actor may not target
  themselves, the server owner, or a bot.
- A non-owner moderator's highest role must outrank the target's role.
  The guild owner may bypass only that human role comparison.
- Discord.js `member.moderatable` must be true. This enforces the bot's
  own role hierarchy and Discord's administrator restrictions.
- Yuugen forcibly re-fetches the moderator and target guild members
  before preview and before confirming, checks the bot member permission,
  and reads the target's `communicationDisabledUntilTimestamp`.
- Both commands show a **private 60-second confirmation** with Confirm and
  Cancel. Only the initiating moderator can confirm the original message
  in the original guild. Expired/canceled prompts and double clicks cannot
  apply multiple actions.
- Confirmations are kept only in RAM. Restarting the bot invalidates them
  safely. The bot limits outstanding prompts to 100 per process.
- Moderation reasons must be 1–512 characters. The preview escapes
  formatting and suppresses mentions.
- A case is always saved **before** asking Discord to modify the timeout.
  If the database is unavailable, Discord is not contacted.

## Case lifecycle and uncertain outcomes

Yuugen uses the existing `moderation_cases` table and adds a nullable
`expiresAt` field for timeout cases.

| Action | Before Discord request | After confirmed success | After definitive rejection |
| --- | --- | --- | --- |
| Timeout | `timeout_pending` | `timeout` | `timeout_failed` |
| Remove timeout | `untimeout_pending` | `untimeout` | `untimeout_failed` |

On confirmed success, the bot records the outcome. Explicit Discord 403
permission failures and error **10007 (Unknown Member)** are recorded as
failures. Network timeouts and other inconclusive failures leave the case
pending. A Discord success followed by a failed database update also leaves
the case pending; no action is retried automatically.

The recorded `expiresAt` is the *intended* timeout expiration, computed
before calling Discord. It may differ slightly from Discord's actual value
and does not indicate that a pending or failed action succeeded. The actual
member timeout should be verified with Discord if the case is pending.

Guild cases and original warnings/bans/kicks are retained. Moderators
must not treat a current missing timeout as proof that a past timeout
was never applied: it may have naturally expired.

## Required database migration before deploying

This is **an additional additive migration**, required because production
TypeORM synchronization is disabled:

```bash
# Backup PostgreSQL first. Apply in order if they are missing.
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261019_economy_integrity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261020_moderation_warnings.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261028_moderation_timeouts.sql
```

These SQL files are designed to be idempotent; still confirm backup, target
database and staged schema state before running them. The new SQL only adds
`moderation_cases.expiresAt` as a nullable `timestamptz` column; it does
not change existing case records, coin balances, or inventories.

**Do not deploy a backend using this entity until the new column exists.**
Do not enable automatic TypeORM synchronization in production. No
migration is run by merging this PR.

## Manual testing on a disposable staging guild

In a network-connected checkout:

```bash
cd backend
npm ci
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Before any real release, use two disposable Discord accounts in a staging
guild, with a bot whose highest role outranks the target.

1. Confirm `/mod timeout` previews a target and duration without changing
   their timeout until Confirm is pressed. Cancel must never change it.
2. Try `0m`, `29d`, `0.5h`, `1w` and invalid reasons; all fail.
   Verify `1m` and `28d` succeed at Discord's supported bounds.
3. Confirm a 10-minute timeout: target is restricted, `/mod cases` shows
   `timeout` and an approximate intended end timestamp.
4. Confirm `/mod untimeout`: Discord removes the timeout and the case
   history shows a new `untimeout` record without erasing the first.
5. Confirm attempting to untimeout someone who is not timed out is rejected.
   Likewise, an already timed-out member is not silently re-timed out.
6. Attempt to timeout the owner, actor, bot and equal/higher ranked member.
   Deny all operations, including administrators (not moderatable).
7. Remove Moderate Members from the moderator or bot after preview but
   before confirming. The action must be rejected.
8. Simulate role changes or the target leaving between preview and confirm.
   The action must be rejected without an audit case.
9. Test confirmation after expiry, another user/guild and rapid repeated
   clicks. Only the first valid confirmation can act.
10. Simulate database failure before saving a case. No member change should
    be attempted. Simulate failure after a Discord success: pending case
    should be flagged for manual review.
11. Test explicit Discord permission rejection (case becomes `*_failed`)
    and network timeout (case stays `*_pending`).
12. Verify no moderation history leaks across guilds and previous warning,
    kick, ban and unban commands still function.
13. Restart the bot: previous case history must persist, while pending
    confirmation buttons must no longer work.

No GitHub Actions workflows are to be enabled to run these tests.
No production deployment or real guild moderation is performed by this PR.
