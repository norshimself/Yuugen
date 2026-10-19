# Yuugen release-readiness checklist

**Status:** source review and smoke-tool self-tests performed; application
builds, Jest, live API, Discord, Lavalink, and production deployments are
**not** verified by this repository change.

## What has and has not been verified

| Check | Result |
| --- | --- |
| Source-level feature audit | Completed; issues fixed on the release-readiness branch |
| Offline `release-smoke.mjs` unit tests | Passed (5/5), Node.js only, mocked transport and local HTTP test |
| Backend `npm ci`, Nest build, Jest | Not run; GitHub/npm network access unavailable |
| Frontend `npm ci`, Next build | Not run; GitHub/npm network access unavailable |
| Real API smoke script | Not run; no connected running backend in the execution environment |
| Discord OAuth, guild permissions, voice, Lavalink, radio | Not run; test guild and runtime required |
| PostgreSQL economy migration | Not run; requires an operator backup and database access |
| Vercel deployment inspection | Blocked by 403 access to the project team scope |
| GitHub Actions | Remain removed by request |

## 1. Manual build and tests

Use Node.js 22 LTS, a suitable npm version, and the checked-in lockfiles.
From the repository root:

```bash
make verify
```

This runs `node --test scripts/release-smoke.test.mjs`, the backend's
`npm ci && npm run build && npm test -- --runInBand && npm run test:e2e -- --runInBand`, and the frontend's
`npm ci && npm run build`. Fix any failures before moving to staging.
GitHub Actions must **not** be re-enabled just to run these tests.

## 2. Database and deployment prerequisites

1. Take a verified PostgreSQL backup.
2. Apply `backend/migrations/20261019_economy_integrity.sql` to staging
   and then production **before** deploying the new backend.
3. Create a root `.env` from `.env.production.example` and set a unique strong
   `POSTGRES_PASSWORD` matching the password in `backend/.env` `DATABASE_URL`.
   `docker-compose.prod.yml` now fails to start if `POSTGRES_PASSWORD` is unset.
4. If PostgreSQL data already exists, changing the Compose environment
   variable **will not** change the initialized database user's password.
   Coordinate a password rotation separately; do not just change `.env`.
5. Run `make verify-prod-config`, which checks Compose rendering only;
   it does not deploy or mutate the database.
6. Ensure production has a strong `JWT_SECRET`, `DATABASE_URL`, frontend
   origin/CORS settings, and registered Discord OAuth redirect.
7. The supplied Nginx container listens on port 80 only. Configure
   HTTPS/WSS at a trusted reverse proxy/TLS termination layer before
   placing the frontend and backend online together.
8. Deploy the backend and frontend as a coordinated release. This change
   does not trigger a production deployment.

TypeORM schema synchronization is disabled in production regardless of any
accidental `TYPEORM_SYNCHRONIZE=true` setting; use reviewed SQL migrations.

## 3. API smoke probes (no credentials)

Start the backend against **staging**, then run:

```bash
YUUGEN_API_URL=https://api-staging.example.com/api/v1 make smoke-api
```

The script checks liveness and live readiness (PostgreSQL, Discord, Lavalink),
including its JSON dependency states. It ensures guild/settings/economy/game
APIs return 401 without a JWT, validates that refresh requests require
the expected client header and session cookie, and checks invalid OAuth
grants and cross-origin requests are rejected. It does **not** exercise
authenticated functionality or write user data. Any failed probe blocks
release until investigated.

## 4. Discord and Lavalink acceptance tests

Use a staging Discord bot, staging database, a test guild, and a disposable
Discord user. Avoid running these tests against active production users.

1. Confirm the Discord Bot token connects and OAuth login/refresh/logout
   succeeds using HTTPS. Verify the browser does not store access/refresh
   tokens in localStorage and the refresh cookie is HttpOnly.
2. Select a mutual guild, list real voice channels, join voice, play a song,
   pause/resume, change volume, skip, stop, and verify the queue.
3. Repeat from two browser tabs; verify WebSocket updates, token renewal,
   and that a user outside the guild cannot subscribe.
4. Test a YouTube playlist, loop/shuffle, filters, a public radio stream,
   and fallback polling with WebSockets unavailable.
5. Confirm a playback backend failure does **not** change the UI to a
   fabricated success state.
6. Enable privileged Discord intents in the Developer Portal **before**
   setting the matching backend flags. Test saved welcome channel/message
   and spam/blacklist moderation; remove bot permissions to test failures.
7. Confirm guild settings reject a non-manager account.

## 5. Economy and Games acceptance tests

With migrated staging DB and two test Discord accounts:

1. Verify existing balances and inventories are unchanged; the economy
   remains global across guilds.
2. Concurrently claim daily rewards and purchase the same item; confirm
   no duplicate payouts or inventory.
3. Run reciprocal robberies, verify the total funds are conserved.
4. Start trivia, reload to resume, answer correctly twice concurrently,
   and verify exactly one payout. Check session expiry and Discord buttons
   from an older prompt.
5. Play RPS from Discord and the browser within one minute; the backend
   must reject the second attempt.
6. The shop currently records virtual items in inventory; test whether
   any advertised external Discord perks are actually fulfilled before
   promoting that UX as a delivered reward.

## 6. Staging-only dashboard activation

The Music tab stays on by default. The other navigation tabs are
**disabled by default** and have independent frontend build-time flags:

```env
NEXT_PUBLIC_ENABLE_ECONOMY=false
NEXT_PUBLIC_ENABLE_GAMES=false
NEXT_PUBLIC_ENABLE_SETTINGS=false
```

After completing the relevant acceptance checks, set a single flag to
`true` on a **staging frontend** and rebuild it. Test mobile and desktop
navigation, error states, balances, trivia cooldowns, and admin permissions.
Keep all flags false on production until the staging sign-off is recorded.
These flags only control navigation visibility: they are **not** a
server-side security boundary. The backend JWT and guild guards remain
necessary.

## 7. Release decision

Do not mark Yuugen production-ready until the builds and tests pass,
migration is applied and verified, authenticated browser/Discord/Lavalink
acceptance tests succeed, HTTPS/WSS is configured, and rollback steps are
documented for the actual deployment environment.

If Vercel access is still denied, an authorized project/team administrator
must restore the connector's access before deployment logs can be inspected.

## 8. Operational readiness

Use `GET /api/v1/status` for lightweight HTTP process liveness and
`GET /api/v1/ready` for real service readiness. Readiness returns HTTP 200
only when a PostgreSQL `SELECT 1` succeeds, Discord reports a ready client,
and Lavalink answers its authenticated `/v4/info` route. It returns HTTP 503
and simple up/down component statuses otherwise (no credentials or hostnames).
The Nginx `/health` route now forwards to this readiness endpoint instead of
always returning a misleading success.

The backend coalesces concurrent readiness requests and caches each report for
two seconds, avoiding a database or Lavalink request per incoming health poll.

An unhealthy Lavalink node can make readiness fail even when the web API is
still serving; this is intentional for a music service. Avoid using this
readiness route as a Docker **process-liveness** signal that restarts the whole
bot during a brief dependency outage. `LAVALINK_HOST` and `LAVALINK_PORT`
are shared by the player connector and readiness checks.
