# Manual staging release evidence and go/no-go gate — issue #92

**State:** Source-only verification tooling. This document does NOT establish
that the backend, frontend, database, Discord bot or Vercel preview have been
deployed or passed staging acceptance. GitHub Actions are intentionally
disabled and must stay disabled. No production deployment is authorized.

Issue #92 is the *release process*, not permission to touch a live user,
database or Discord guild. Use an operator-approved **disposable staging VPS,
database, Discord bot/guild and matching frontend preview** for all runtime
checks. Obtain Vercel/team access from an authorized administrator first.
If staging access is missing, record the requirement as `blocked`.

## 1. Source/build checks (before creating a staging deployment)

Pin the exact source commit and run the dependency-install/build/test steps.
On the manual verification machine, Node 22+ and the checked-in lockfiles
are required; do not enable GitHub Actions to obtain a green check.

```sh
git rev-parse HEAD
make verify-smoke-tool
make verify-backend
make verify-frontend
make verify-prod-config
```

`make verify-backend` runs backend `npm ci`, NestJS build, Jest and isolated
e2e. `make verify-frontend` runs frontend `npm ci` and Next.js build. Record
*separate* result artifacts for these commands, with tool versions, precise
source SHA, exit codes, timestamps and **redacted** failure summaries.
Never convert an unavailable npm package registry or test runner into PASS.

The repo smoke tests are *offline mocked checks*, not evidence of a live
API, connected database, OAuth authorization or Discord/Lavalink response.

## 2. Disposable staging deployment and backup rehearsal

1. Provision an isolated staging backend/VPS and PostgreSQL 17 instance;
   use a dedicated Discord application, empty guild and disposable users.
   Keep database and Lavalink ports private; do not expose database creds
   or health diagnostics publicly. Obtain explicit staging authorization.
2. Obtain the correct Vercel team/project permissions for an isolated
   frontend **preview**. Pin its build to the exact backend source and
   frontend environment settings. Keep Economy/Games/Settings feature
   flags **off by default** pending module-specific acceptance.
3. Configure TLS on the staging reverse proxy. The checked-in production
   Compose Nginx publishes HTTP port 80; it is NOT evidence of HTTPS/WSS.
   Confirm a valid certificate, HTTPS redirect, correct cookie domain, a
   real `wss://.../api/v1/player/ws` handshake, and no insecure fallback.
   Do not send JWTs to arbitrary HTTPS hosts.
4. Take a verified backup **of disposable staging data only** before
   schema changes. Restore it to a distinct disposable database, compare
   schema/data counts and log an independent restore result. Never test
   restore on the running production database.
5. After parent migration runner #89 / PR #109 is reviewed, apply its
   versioned manifest to disposable staging in order, including whichever
   feature migrations have actually been merged. Record exact migration
   SHA/version, schema/constraint state and rollback rehearsal. The draft
   migration runner and scheduler PR #110 are **not** release-approved.
6. Record the tested backend/frontend image IDs and a **staging-only**
   rollback procedure. Rehearse returning to the previous images without
   dropping newly created ledger/audit tables or restoring erased data
   without a separately approved privacy decision.

No deployment, SQL migration, restore or Discord action is performed
by the release evidence verifier. The operator runs approved steps manually.

## 3. Real API and interactive Discord acceptance

Use `make smoke-api` with `YUUGEN_API_URL=https://.../api/v1` to verify
liveness, true database/Discord/Lavalink readiness and protected routes.
The unauthenticated smoke runner now rejects query strings, URL fragments,
credential-bearing URLs and any base path other than exactly `/api/v1`;
it never forwards an operator-supplied OAuth fragment/token in probe URLs.
A 200 response with malformed readiness JSON or a 503 from a required
dependency is a release blocker.
Run `make staging-acceptance` with a 15-minute disposable test JWT and
`YUUGEN_STAGING_HOST` *exactly matching* `YUUGEN_STAGING_API_URL`'s
hostname. It is read-only by default. The host requirement is enforced
even for GET probes because the script can transmit a bearer token.
Before the **first** bearer-token request, it requires successful database,
Discord and Lavalink readiness and a 401 denial for an anonymous guild
listing request. If either preflight fails it records a blocked run and
skips all token-bearing HTTP and WebSocket probes, even when writes were
explicitly opted in.

The voice and economy write modes are separately opt-in and require a
disposable guild, staging host and test account.
Before **any** opted-in POST, all read-only prerequisites (including available
services, cross-guild authorization and WebSocket checks) must succeed. A
failed prerequisite results in a SKIP and a failed run, not a partial action.
Malformed WebSocket frames/send failures are contained as failed checks. See
`docs/staging-acceptance.md`. Neither the smoke script nor simulated
Node unit tests replace a browser OAuth, HTTP-only refresh cookie, logout,
WSS, music/Lavalink, moderation or permissions rehearsal.

For a **disposable** Discord guild, verify bot/member permissions and role
hierarchy, callback exchange and token expiration, non-manager/non-member
denial, channel deletion and target changes, message moderation, queue
tracking and read-only degraded-dependency behavior. Simulate PostgreSQL
or Lavalink unavailability only with operator approval on disposable
staging, and verify `/ready` returns 503 while liveness remains available.
Do not intentionally interrupt a shared or production dependency.

Check structured application logs under a test OAuth callback containing
query `code` and `state`; the HTTP logger on this PR uses router route
templates and never logs raw request URLs, query strings, headers or tokens.
Inspect operational metrics, authentication error rates, readiness probes,
reconnect behavior and rollback alarms. **Redact** all evidence *before*
hashing it; never upload raw JWTs, passwords, cookies, guild/member PII,
OAuth codes or user content to GitHub or ChatGPT.

## 4. Local evidence format (blocked by default)

The source-controlled `docs/release-evidence.template.json` deliberately
sets every check to `not_run` and has no approvals. It is **not** test
evidence. Copy it into a restricted directory **outside the Git repo**,
rename it `release-evidence.json`, and fill in the exact tested SHA,
disposable staging origins and guild ID.

Each of the 19 named check entries uses exactly:

```json
{
  "id": "api_smoke_readiness",
  "status": "pass",
  "artifact": "evidence/api-smoke-redacted.txt",
  "sha256": "REPLACE_WITH_SHA256_OF_THE_LOCAL_REDACTED_FILE",
  "performedAt": "2026-10-31T00:00:00.000Z"
}
```

Do **not** change a status to `pass` without executing that check and
recording its redacted local evidence under the manifest directory's
`evidence/` subfolder. Each PASS requires a **different regular file** with an exact SHA-256
digest and UTC timestamp within **14 days** of verification. Sharing a
logfile between checks or reviewer approvals, even through a hard link,
fails the gate; symlinks are rejected even when they resolve inside the
evidence directory. This stops one successful offline log from standing
in for unrelated database, browser, Discord and rollback checks.
Failed, blocked and not-run checks always block promotion. The verifier
rejects unknown/duplicate checks, mismatched release commits,
insecure/credentialed origins, paths outside the manifest's directory,
missing/modified artifacts, stale results and extra fields.

Three *distinct* reviewers must add independently reviewed local artifacts
for `backend_owner`, `staging_operator` and `security_reviewer` approvals.
Approval entries contain `role`, `reviewer` (short reviewer handle),
`artifact`, `sha256` and `performedAt`. These files are integrity-checked
but **are not digitally signed**: verify the reviewers' authority and
the underlying evidence through your organization's process.

Run on the approved local operator machine:

```sh
node scripts/release-gate.mjs /path/to/private/release-evidence.json \
  --commit "$(git rev-parse HEAD)"
```

Exit codes: **0** means all 19 checks and three required approvals have
matching recent evidence for that source SHA; it means *eligible for a
separate promotion decision*, **not an automatic deployment**. **1**
means at least one check or approval is missing, failed, stale or unverified;
**2** means malformed input or an execution error. The program prints
only fixed check IDs and PASS/BLOCK reason codes, never the artifact contents
or reviewer names.

**The gate cannot prove that logs are truthful or that a reviewer is
genuine**. It is a local checklist and evidence-integrity tool, not a
production authorization mechanism. A real staging operator and security
review must still attest to the results. Keep artifacts access-controlled
and do not commit them; the repo ignores `release-evidence.json` and
`evidence/` directories.

## 5. Gate coverage map

| Required check ID | Evidence required |
| --- | --- |
| `offline_tool_tests` | Node smoke, staging-harness and release-gate unit tests |
| `backend_npm_install_build` | npm lockfile install + NestJS build |
| `backend_jest`, `backend_e2e` | Real backend tests and isolated e2e |
| `frontend_npm_install_build` | npm lockfile install + preview build |
| `compose_config` | Production-like Compose configuration, without starting services |
| `staging_database_backup` | Verified disposable-staging backup checksum |
| `staging_migration_rehearsal` | Versioned migration manifest/apply outcome |
| `database_restore_rehearsal` | Restore into separate disposable instance |
| `frontend_preview_https` | Matching frontend preview TLS and navigation |
| `backend_https_wss` | Backend TLS and authenticated WebSocket handshake |
| `oauth_refresh_logout` | Real browser OAuth, cookie, renew/revoke checks |
| `api_smoke_readiness` | Real HTTP smoke, auth denial and dependency health |
| `authenticated_guild_checks` | JWT + live manager/nonmember/cross-guild denial |
| `discord_voice_lavalink` | Disposable voice/music flow and safe cleanup |
| `moderation_permissions` | Disposable Discord moderation, permissions and audit |
| `dependency_outage_behavior` | Isolated 503 readiness and graceful API errors |
| `rollback_rehearsal` | Previous image/config restoration with retained data |
| `metrics_logs_redaction` | Useful alerts, scrubbed OAuth/secret logs and diagnostics |

## 6. Unresolved blockers for issue #92

A green local evidence verifier is **not** currently possible without real
staging VPS, frontend preview, Discord app, PostgreSQL 17, complete NestJS
dependencies/Jest tests, reviewed migration manifest, backup/restore exercise,
and human operator/security sign-off. Vercel team/project access may also
be required. Leave #92 open and the PR in draft until the release
acceptance criteria are demonstrated in that environment.

**Safety:** GitHub Actions remain disabled. No scripts in this PR deploy
or mutate the production or staging database; no bot actions are triggered.
