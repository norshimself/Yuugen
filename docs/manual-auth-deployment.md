# Yuugen: manually deploy the first-party OAuth session flow

GitHub Actions are intentionally disabled. Deploy backend and frontend manually as
one coordinated release. Old login tokens and refresh-token headers no longer work;
users must sign in again.

## Configuration

Backend `backend/.env`:

- `DISCORD_CLIENT_ID`, `DISCORD_CLIENT_SECRET`, `DISCORD_TOKEN`: Discord app.
- `DISCORD_REDIRECT_URI`: **backend** URL ending in
  `/api/v1/auth/callback`. Register this exact URL in the Discord portal.
- `JWT_SECRET`: high-entropy secret with at least 32 characters.
- `FRONTEND_URL`: HTTPS frontend origin, e.g.
  `https://yuugen-flax.vercel.app` (no trailing callback path).
- `CORS_ORIGIN`: the same frontend origin, or a comma-separated list of
  trusted frontend origins if previews are required.
- `PORT=3000` inside the backend Docker container. The host may publish
  `localhost:3001` via Compose port mapping.

Frontend deployment variables on Vercel:

- `BACKEND_API_URL`: backend **origin only** (server-side secretless rewrite
  setting), e.g. `https://api.example.com`, without `/api`.
- `NEXT_PUBLIC_BACKEND_URL`: absolute backend API URL, e.g.
  `https://api.example.com/api/v1`, for Discord login and native WebSockets.
  Both HTTPS and WSS must be publicly reachable.
- `NEXT_PUBLIC_ENABLE_DEMO_LOGIN=false`.

The old `NEXT_PUBLIC_API_URL` is accepted as a transition fallback for
the backend origin, but should be removed after configuring both new variables.

For local development, start the backend so it is reachable at
`http://localhost:3001`, set the backend `FRONTEND_URL=http://localhost:3000`,
and use these frontend values:

```env
BACKEND_API_URL=http://localhost:3001
NEXT_PUBLIC_BACKEND_URL=http://localhost:3001/api/v1
```

## How authentication now works

1. Browser visits the **backend** `/api/v1/auth/login`.
2. Backend sets a five-minute HttpOnly OAuth-state cookie and redirects to
   Discord. On the callback, the state must match.
3. Backend issues a random, two-minute, single-use grant. Only its hash is
   persisted in PostgreSQL, in the existing `sessions` table. The browser is
   redirected to `FRONTEND_URL/callback#code=...`.
4. The frontend immediately removes the fragment from browser history and
   calls its same-origin `POST /api/v1/auth/exchange`. The Next.js rewrite
   forwards the request to the backend.
5. The exchange atomically consumes the grant and returns a 15-minute access
   JWT in JSON. Its seven-day refresh session ID is set only as an HttpOnly,
   Secure (in production), SameSite=Lax cookie on the **frontend origin**,
   scoped to `/api/v1/auth`.
6. The browser keeps the JWT **in JavaScript memory only**. On reload and
   subsequent token expiry it obtains a fresh JWT using the first-party
   cookie; it never writes credentials to `localStorage`.
7. Logout revokes the session in PostgreSQL and clears the refresh cookie.
   Already-issued JWTs may remain valid until their 15-minute expiry.

The UI continues to use a direct `wss://` connection for live player events,
authenticated by a JWT in the subscription message. The client renews its
subscription every ten minutes.

## Manual smoke tests (required before production traffic)

1. From a clean browser profile, open Login, sign in through Discord, and
   confirm the redirected URL does not contain `access_token` or
   `refresh_token`. The `#code` fragment should disappear immediately.
2. In browser DevTools, verify neither `access_token` nor `refresh_token`
   appears in Application → Local Storage. A `yuugen_session` cookie should
   exist for the **frontend** host, HttpOnly, Secure (production), path
   `/api/v1/auth`.
3. Reload `/player`; `POST /api/v1/auth/refresh` must restore the session.
4. Verify guild listing only returns mutual guilds and music, voice channel
   joins, and player WebSocket broadcasts continue to work.
5. Try exchanging the same one-time code twice and with a stale code; both
   attempts after the first must fail with 401.
6. Log out, reload `/player`, and confirm that it redirects to Login.
7. Check a separate test guild's permissions: non-members cannot subscribe to
   live player events, and non-admins cannot change guild settings.
8. Test the same flow behind production HTTPS/WSS. Vercel must have
   `BACKEND_API_URL` configured before it builds the frontend.

## Local checks (no GitHub Actions)

```bash
cd backend
npm ci
npm run build
npm test -- --runInBand

cd ../frontend
npm ci
npm run build
```

Existing database schema is reused, so this authentication update does not
require TypeORM synchronization or a migration. A later release should add
database migrations, cleanup policies for expired sessions, and production
outbound-network restrictions for Lavalink and radio metadata fetches.
