# Staging acceptance: Discord OAuth, voice, WebSockets and economy

**Status:** The staging harness has been exercised with simulated HTTP and
WebSocket responses (9/9 Node tests passed). This is **not evidence that
Yuugen's real Discord bot, database, Lavalink, or Vercel deployment works**.
Run these checks on a correctly configured, disposable staging environment
before enabling the dashboard tabs or promoting a release.

Node.js 22+ is required. No additional npm dependencies are needed for
the harness itself, and GitHub Actions stay disabled.

## Before testing

1. Complete `make verify` (backend/frontend build, Jest, isolated e2e,
   smoke-checker and staging-runner tests). On a machine that can download
   npm packages, run `npm ci` from both subprojects as directed.
2. Create a **separate staging Discord bot**, test Discord server with an empty
   voice channel, PostgreSQL database, and Lavalink node. Do not run
   state-changing tests against active production users or servers.
3. Apply `backend/migrations/20261019_economy_integrity.sql` to a **backup or
   staging database** before starting the updated backend.
4. Set backend `FRONTEND_URL`, `CORS_ORIGIN`, `DISCORD_REDIRECT_URI`,
   `JWT_SECRET`, `LAVALINK_HOST`, `LAVALINK_PORT`, and credentials correctly.
   The frontend needs `BACKEND_API_URL` and `NEXT_PUBLIC_BACKEND_URL`.
   Use HTTPS and WSS when staging is not localhost.
5. Use a disposable staging Discord account that is a member of the test
   server. Gather its guild ID and an accessible voice-channel ID.

## 1. Browser OAuth acceptance (manual)

These checks require an actual interactive Discord account. Do not share a
Discord password, cookie, OAuth code, or JWT with ChatGPT or paste them into
the repo, PRs, terminal history, or logs.

- Open the staging frontend in a clean browser profile and click Discord
  login. Confirm Discord returns to the **backend** callback, then the
  frontend `/callback`, without access or refresh tokens in URL query.
- The short-lived code fragment should disappear immediately.
- Verify an `HttpOnly`, `SameSite=Lax` cookie named `yuugen_session` is
  set on the **frontend host** with path `/api/v1/auth` and `Secure`
  enabled under HTTPS.
- Confirm browser localStorage contains no `access_token` or
  `refresh_token` values.
- Reload `/player`. The first-party POST `/api/v1/auth/refresh` should
  restore the session; no cross-site refresh-cookie transmission is needed.
- Confirm only mutual Discord servers appear. Logout, reload, and verify
  authentication is required again. A second/expired login code must be
  rejected.
- Check browser Console/Network for CORS and WebSocket errors.

The authenticated acceptance CLI accepts **one short-lived staging JWT**
through a local environment variable. Use the access JWT from the
`auth/refresh` JSON response in your **own staging browser's Network tab**;
it expires after 15 minutes. Do not upload it anywhere.

## 2. Read-only authenticated checks (default)

Set the variables locally, without checking credentials into Git:

```bash
export YUUGEN_STAGING_API_URL=https://api.staging.example.test/api/v1
export YUUGEN_STAGING_HOST=api.staging.example.test
export YUUGEN_TEST_GUILD_ID=123456789012345678
read -rsp 'Temporary staging JWT: ' YUUGEN_TEST_ACCESS_TOKEN
echo
export YUUGEN_TEST_ACCESS_TOKEN
make staging-acceptance
unset YUUGEN_TEST_ACCESS_TOKEN
```

Even read-only requests contain an authenticated bearer JWT. All runs now
require `YUUGEN_STAGING_HOST` exactly matching the backend hostname and a
staging/test/development host marker. This prevents a mistyped backend URL
from silently sending a disposable account's token to an unrelated server.
The hostname check is a guardrail, **not** an independent proof that the
destination is non-production. Error logs/results redact supplied bearer
tokens and named authentication fields.

The default harness makes **no state-changing API requests**. It checks:
backend dependency readiness, unauthenticated JWT rejection, the authenticated
mutual guild list, accessible voice channels, current player state and queue,
a valid native WebSocket guild subscription, and invalid-token rejection.

Optional additional access-control checks, using temporary test account
tokens in the environment:

```bash
export YUUGEN_TEST_OUTSIDER_ACCESS_TOKEN=...
export YUUGEN_TEST_NONADMIN_ACCESS_TOKEN=...
```

The outsider must **not** be a member of the test guild. The non-admin must
be a member without the Discord Manage Server permission. Those checks are
skipped if the matching tokens are absent.

Each check is reported PASS/FAIL, exits nonzero on failures, and does not
print token values.

**Fail-closed write preflight:** Even with `YUUGEN_TEST_VOICE=yes` or
`YUUGEN_TEST_ECONOMY=yes`, *no POST requests are issued* if **any** prior
read-only check fails—database/Discord/Lavalink readiness, anonymous JWT
rejection, mutual guild membership, channel/queue reads, live WebSocket
authorization, or optional outsider/non-manager permissions. A failed voice
test also prevents the economy test from proceeding in the same run. The
harness prints a SKIP notice; the original failed check still blocks release.
Malformed WebSocket frames and send errors fail gracefully without logging
bearer credentials. Test only against a completely disposable guild.

## 3. Opt-in voice and Lavalink acceptance

**Only** with a disposable test guild and inactive voice channel, add:

```bash
export YUUGEN_STAGING_HOST=api.staging.example.test
export YUUGEN_TEST_ALLOW_WRITES=staging-only
export YUUGEN_TEST_DISPOSABLE_GUILD=yes
export YUUGEN_TEST_VOICE=yes
export YUUGEN_TEST_VOICE_CHANNEL_ID=234567890123456789
export YUUGEN_TEST_TRACK_QUERY='ytsearch:your staging audio test'
make staging-acceptance
```

The hostname must contain `staging`, `stage`, `test`, `dev`, or
`local` (or be localhost) and must exactly match
`YUUGEN_STAGING_HOST`. This is an additional safety check, not proof that
an environment is non-production.

The harness refuses to touch a player that is already connected/playing,
then joins voice, plays a track, checks Lavalink's nowplaying state,
pauses/resumes, and **stops the bot in a finally block** even when the
playback test fails. Do not run this against a server that people are using.

## 4. Opt-in economy and trivia acceptance

For a new disposable staging account (not a production wallet):

```bash
export YUUGEN_STAGING_HOST=api.staging.example.test
export YUUGEN_TEST_ALLOW_WRITES=staging-only
export YUUGEN_TEST_DISPOSABLE_GUILD=yes
export YUUGEN_TEST_DISPOSABLE_ACCOUNT=yes
export YUUGEN_TEST_ECONOMY=yes
make staging-acceptance
```

This mutates staging balances and sessions. It plays rock–paper–scissors
twice to verify the 60-second shared cooldown, then creates a trivia
session using **POST** `/api/v1/games/trivia/question` and submits the
same answer twice, checking that only the first is accepted. The first
attempt may fail if the test account is already on cooldown. Use a fresh
disposable account rather than tampering with a production wallet.

## 5. Acceptance sign-off and release order

- Record all PASS/FAIL results for a staging deployment, including
  `make verify`, `make smoke-api`, and `make staging-acceptance`.
- Browser OAuth, cookie renewal, logout and visual behavior require manual
  sign-off; this CLI cannot perform interactive Discord OAuth.
- Separate from the CLI, verify playlist playback, filters/radio, two-tab
  WebSocket synchronization, guild admin settings, moderation, shop balance
  transactions, and backup/restore/rollback in staging.
- `POST /games/trivia/question` replaces the old mutating GET.
  **Deploy the matching backend and frontend together** to prevent route
  mismatches.
- Only after sign-off should the relevant `NEXT_PUBLIC_ENABLE_*` dashboard
  build flags be enabled. All remain false by default.
- GitHub Actions workflows are removed; this plan uses manual execution.
