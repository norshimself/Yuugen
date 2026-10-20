# Yuugen moderation: persistent warnings (feature 1)

This is the first piece of Yuugen's modular moderation system.

## Discord commands

- `/mod warn user:<member> reason:<text>` — record a warning with a reason.
- `/mod warnings user:<user>` — show up to 10 recent warning cases in the
  current guild. Revoked warnings remain visible in history.
- `/mod unwarn id:<number> reason:<optional>` — revoke an active warning
  without erasing the historical record.

All replies are private to the invoking moderator. Staff must have the
Discord **Moderate Members** permission (or Administrator) at execution time.
Warnings are guild-scoped: a case from guild A cannot be listed or revoked
from guild B. A moderator cannot warn themselves, bots, the server owner,
or a member with an equal/higher role. The server owner can warn other
members irrespective of their own role position.

The first release records warnings but does **not** automatically timeout,
kick, ban, assign strikes, or send DMs. Those policies and actions should be
separate features so guild owners can explicitly opt in. There is no dashboard
moderation view yet.

## Database migration — required before deployment

1. Back up PostgreSQL.
2. Ensure the earlier economy migration has already been applied.
3. Apply the new migration **before** restarting the backend:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/20261020_moderation_warnings.sql
```

The migration creates `moderation_cases` and its guild/target lookup index.
The table supports future moderation action types, but this feature inserts
only `warn` cases. It does not change existing XP or coin balances.
Production TypeORM auto-sync stays disabled.

### Permissions and privacy

- The bot needs **Use Application Commands**; issuing or viewing a warning
  does not require its Discord Kick/Ban/Moderate Members permission.
- The moderator needs **Moderate Members**, checked server-side on each action.
- The target must currently belong to the server to be warned.
- All replies are ephemeral and suppress user/role mass mentions.
- Warnings store the server ID, target ID, moderator ID, reason, creation time,
  and optional revocation details in PostgreSQL.
- Revoking a warning preserves the case for accountability. A retention/deletion
  policy and administrator data-export tools should be designed before broad
  public rollout.

## Manual checks

Run from a network-connected staging environment:

```bash
cd backend
npm ci
npm run build
npm test -- --runInBand
```

Against a disposable test guild:

1. Apply the migration to the staging database and restart the bot.
2. As a regular member, try all three subcommands. They must reject access.
3. As a moderator with Moderate Members, warn a lower-ranked member.
4. Check `/mod warnings` shows the case and correct reason.
5. Try warning the owner, bot, yourself, and a higher-ranked member.
   All must be rejected without creating cases.
6. Revoke the warning, then verify it is still visible as revoked.
7. Try revoking the same case twice; the second attempt must not succeed.
8. Repeat with two guilds: history and case IDs must not leak across them.
9. Restart the bot and confirm the warning history still exists.

Because GitHub Actions are intentionally removed, these tests are manual.
Do not deploy this branch before migrating its database.
