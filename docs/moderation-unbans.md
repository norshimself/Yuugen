# Yuugen moderation: confirmed unbans (issue #50)

This module extends the permanent ban command (issue #49, PR #94) and
reuses the guild-scoped moderation case table from warnings and kicks.

## Discord commands

- `/mod unban user_id:<Discord user ID> reason:<text>` — verify an existing
  guild ban, then privately preview and confirm or cancel its removal.
- `/mod cases user_id:<Discord user ID>` — show recent warning, kick, ban,
  and unban cases for a member or former member.

A banned user is not selectable as a current guild member. The **user ID**
is therefore required, and it must contain 17–20 decimal digits. Obtain the
ID from the original ban record, an existing moderation case, or Discord's
developer tools. Unban does not automatically invite or rejoin the user.

## Permissions and safety

- The moderator and Yuugen both need **Ban Members**.
- Self and server-owner IDs are rejected. The target is absent from the
  guild, so its past role hierarchy is not available or relevant to unban.
- The bot performs a **forced, uncached guild ban lookup** using
  `guild.bans.fetch({ user: targetId, force: true })` before the preview
  and again after confirmation, to avoid acting on stale cached bans.
- A missing ban (Discord error code **10026, Unknown Ban**) blocks the action
  before any case is created. Other API failures block the action rather
  than assuming the user is banned. A generic 404 is **not** trusted as proof
  of a missing ban.
- The private confirmation belongs to one moderator, guild and message, and
  expires in **60 seconds**. Cancel, expiry and double clicks cannot unban.
- The bot checks the moderator's membership and both parties' permissions
  again immediately before the unban.
- Pending confirmations live in memory. A bot restart invalidates them.
- The audit reason is required (1–512 characters). User-supplied content
  is escaped in the interaction; mentions are suppressed.
- The bot unbans only from the interaction's actual guild. It does not
  affect the same user in any other Discord server.

## Durable moderation cases

Unbanning removes the active Discord ban, **not** the original ban case.

1. Save a new **`unban_pending`** case to PostgreSQL *before* calling the
   Discord unban API. A failed DB write blocks the API call.
2. If Discord confirms success, atomically mark the new case **`unban`**.
3. If Discord explicitly rejects the request (403 or Unknown Ban 10026),
   atomically mark it **`unban_failed`**.
4. If the network times out or finalizing the DB case fails, leave it
   **`unban_pending`** for staff reconciliation; do not automatically retry.

An administrator should check the **actual guild ban list and audit log**
before retrying uncertain unban outcomes. A user can be unbanned yet the
case remain pending after a DB error. The same ID can remain in historic
ban cases while the later unban case records the reversal.

## Database and deployment

**No new PostgreSQL schema migration is required.** The existing
`moderation_cases.action` varchar(24) column already accommodates
`unban_pending`, `unban`, and `unban_failed`.

Before deploying the updated bot, back up PostgreSQL and ensure the
existing migration has been applied:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261020_moderation_warnings.sql
```

Never enable TypeORM production schema synchronization.

## Manual staging acceptance checklist

Run from a network-connected environment:

```bash
cd backend
npm ci
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

In a disposable Discord guild with two test accounts and a test bot:

1. Ban a disposable test user using `/mod ban`.
2. As a moderator with Ban Members, use `/mod unban user_id:<id>`.
   Confirm the user **stays banned** until the confirmation is pressed.
3. Click Cancel. Verify the user is still banned and no unban case exists.
4. Retry and Confirm. Verify the ban is removed and a new `unban` case
   is visible through `/mod cases user_id:<id>`.
5. Confirm the earlier `ban` case is still present in history.
6. Attempt to unban the same user again; it must stop at the ban lookup
   and never call the Discord remove endpoint.
7. Test malformed IDs, self ID, owner ID, empty reason and overlong reason.
8. Remove Ban Members from the moderator between preview and confirm.
   The action must stop without creating a case or removing a ban.
9. Remove Ban Members from the bot between preview and confirm.
   The action must stop without removing a ban.
10. Have a different moderator attempt to click Confirm, and test an
    expired confirmation. Neither may unban.
11. Test two simultaneous clicks; only one case and one API call may occur.
12. Test API access denied or another ban-list outage at preview or
    confirmation; no unban occurs.
13. Test database outage before creating a pending case; no API call occurs.
14. Test a definite Discord 403/Unknown Ban rejection (case becomes
    `unban_failed`) and a network timeout (case stays `unban_pending`).
15. Verify the guild ID is enforced and no other guild's bans or cases
    are accessible; restart bot and verify history persists.

The source's isolated policy compilation/assertions are not a substitute
for a real NestJS build, PostgreSQL transaction testing or Discord staging
acceptance. **Do not test real community members.** GitHub Actions stay
disabled, and this issue does not authorize deployment or DB changes.
