# Yuugen economy integrity and trivia recovery

## Scope and currency ownership

Balances, inventory, experience points, and trivia sessions are **global per
Discord user**, as in previous Yuugen releases. Selecting a different guild
does **not** create another wallet. This update deliberately preserves all
existing data instead of arbitrarily splitting balances across guilds.

To introduce a per-guild economy in a future release, decide on currency
migration, leaderboard behavior, cross-server inventory, and robbing policy
before replacing the existing `userId` primary key.

## Required database change (production)

Production has `TYPEORM_SYNCHRONIZE=false`, so run the new migration before
deploying this code. Take a PostgreSQL backup first, then run from the host
containing your database connectivity:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/20261019_economy_integrity.sql
```

If you normally use the `docker-compose.prod.yml` PostgreSQL container,
run the SQL file through an authenticated `psql` session in that container
instead. Do **not** enable TypeORM schema synchronization in production.
This migration only adds nullable columns and an index; it does not alter
existing balances or inventory.

New columns:

- `user_profiles.lastRps` — last rock-paper-scissors play timestamp.
- `user_profiles.lastTrivia` — last trivia start timestamp (two-minute cooldown).
- `trivia_sessions.questionId` — trivia question used in the session.
- `trivia_sessions.messageId` — Discord message containing the buttons,
  so old messages cannot answer a later question.

Existing trivia sessions have a null `questionId`; the next question request
automatically discards them and starts a new session.

## Concurrency protections

- All balance-changing operations lock the affected user row within a
  PostgreSQL transaction, preventing lost updates.
- Robbery locks both profiles in sorted user-ID order and transfers funds
  atomically. The returned failure fine is the **amount actually deducted**.
- Creating a profile uses `INSERT ... ON CONFLICT DO NOTHING`, avoiding
  duplicate-key races when several bot/API events arrive simultaneously.
- The same transaction that resolves a trivia answer also deletes the session
  and (only if correct) credits coins; duplicate answers cannot pay twice.
- Starting a new trivia question has a two-minute per-user cooldown to limit reward farming. An active unexpired question can still be resumed immediately.
- The trivia start/resume API now uses `POST /api/v1/games/trivia/question`, because it can create a persisted session. The web app and backend must be deployed together.
- A trivia question can resume after a browser refresh for up to 15 minutes.
  Expired sessions automatically reset; no admin cleanup is necessary.
- Discord trivia replies are bound to the Discord prompt message ID; stale
  buttons cannot answer a newer game.
- Rock-paper-scissors attempts have a 60-second per-user cooldown, shared by
  Discord and web API. Wins award 20 coins. All attempts, including losses and
  ties, start the cooldown.
- Economy wager size is constrained to 1–100,000 coins; balances cannot exceed
  the PostgreSQL integer column limit.

## Manual acceptance checklist

1. Run the PostgreSQL migration against a **test copy** of the database.
2. In `backend/`, run `npm ci && npm run build && npm test -- --runInBand`.
   In `frontend/`, run `npm ci && npm run build`.
3. With one Discord user, run `/daily` simultaneously from two clients;
   confirm only one request awards coins.
4. Win Rock Paper Scissors and immediately try the website endpoint and a
   Discord button; the second attempt must be rejected for 60 seconds.
5. Purchase one shop item twice concurrently; only one purchase should
   succeed, and the wallet must decrease exactly once.
6. Try reciprocal robberies from two test users in parallel; no deadlock
   should persist and no coins should be created or lost.
7. Start trivia on the web and refresh; verify the **same question** returns.
8. Submit the same correct answer twice concurrently; only one answer should
   award coins. After 15 minutes, the session should expire and start anew.
9. On Discord, create two trivia prompts and press buttons on the older
   message; older buttons must not claim the new question.
10. Verify preexisting wallet balances and inventory are unchanged.

GitHub Actions are still intentionally removed. Build and acceptance checks
must be performed manually before releasing to production.
