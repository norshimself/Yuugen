# Yuugen

Yuugen is a Discord music bot and web management console. The backend uses NestJS,
Discord.js/Necord, Lavalink and PostgreSQL; the web dashboard uses Next.js.
The music dashboard is the currently enabled section. Economy, Games, and Settings
are feature-flagged until their staging acceptance checks pass.

## Getting started

1. Copy `backend/.env.example` to `backend/.env` and set Discord, database,
   Lavalink, and a strong `JWT_SECRET` (32+ characters).
2. Start PostgreSQL, Lavalink, and the backend: `docker compose up --build -d`.
3. Copy `frontend/.env.example` to `frontend/.env.local`. From `frontend/`,
   run `npm ci && npm run dev` to start the web dashboard on localhost:3000.
4. Register the Discord OAuth redirect shown in `backend/.env` with Discord.

## Local release checks

- `make verify`: Node smoke-tool tests, backend build/unit+isolated e2e tests, and frontend build.
- `make staging-acceptance`: opt-in authenticated guild/WebSocket tests (read-only by default, see guide).
- `make smoke-api`: harmless unauthenticated health/authorization probes against
  the running backend (default localhost:3001). Use `YUUGEN_API_URL` to override.
- `make verify-prod-config`: validates Compose configuration without deploying;
  requires a strong `POSTGRES_PASSWORD` in the repository root `.env`.

**Do not deploy the latest economy changes before applying**
`backend/migrations/20261019_economy_integrity.sql` to a backed-up PostgreSQL
database. Never enable TypeORM auto-synchronization in production.

## Operator guides

- [Release-readiness matrix and test plan](docs/release-readiness.md)
- [Staging OAuth, WebSocket, voice and economy acceptance](docs/staging-acceptance.md)
- [Manual authentication deployment](docs/manual-auth-deployment.md)
- [Guild welcome and moderation](docs/guild-welcome-moderation.md)
- [Moderation warnings and case history](docs/moderation-warnings.md)
- [Confirmed kicks and moderation audit cases](docs/moderation-kicks.md)
- [Confirmed permanent bans and case history](docs/moderation-bans.md)
- [Confirmed unbans and retained ban history](docs/moderation-unbans.md)
- [Temporary timeouts, removal and case audit](docs/moderation-timeouts.md)
- [Safe message purge and audit log](docs/moderation-purges.md)
- [Channel lock/unlock and permission-safe restoration](docs/moderation-channel-locks.md)
- [Per-guild AutoMod rules and dry-run](docs/automod-engine.md)
- [Voice moderation: mute, deafen, disconnect and move](docs/moderation-voice.md)
- [Economy migration and transaction checks](docs/economy-integrity.md)
- [Privacy inventory, user/guild exports, explicit erasure and opt-in TTL cleanup](docs/privacy-export-retention.md)

GitHub Actions workflows are intentionally removed because CI usage is paused.
Builds, database migrations, and Discord/Lavalink acceptance tests therefore
require manual execution. This repository should not be considered production
verified solely because a pull request is merged.

Use `/api/v1/ready` (or the Nginx `/health` proxy) to verify PostgreSQL,
Discord, and Lavalink readiness; `/api/v1/status` is HTTP liveness only.
