# PostgreSQL migration runner — issue #89

Source-only delivery. **No migration, backup, rollback or production deployment has
been run as part of this change.** The operations below require operator sign-off.

## Scope and safety

The ordered \`backend/migrations/manifest.json\` registers all seven SQL files
currently merged into \`main\`. New migrations must be appended in dependency
order, never renamed or edited after application. The SHA-256 checksum of each
exact SQL file is stored in \`public.yuugen_schema_migrations\`.

The CLI can inspect pending versions without schema writes. Apply runs the
entire pending batch in one PostgreSQL transaction with a transaction-scoped
advisory lock shared by concurrent runner instances, then records versions
and commits DDL and ledger together. Failed SQL rolls back the whole batch.
A second runner waits and re-reads the ledger under the lock.

The runner intentionally rejects existing histories with gaps, unknown versions,
duplicates or altered checksums. The present SQL files have outer BEGIN/COMMIT;
the runner strips those wrappers and executes their bodies inside its controlled
transaction. Do not add nontransactional statements (e.g. CREATE INDEX
CONCURRENTLY) to this manifest without redesigning the runner.

## Commands

Use Node.js 22, \`npm ci\` in \`backend/\`, and an explicit staging URL stored
only in your local environment, **never in issues or shell history**:

\`\`\`bash
cd backend
npm ci
DATABASE_URL="$STAGING_DATABASE_URL" node scripts/migrate.mjs status --environment staging
DATABASE_URL="$STAGING_DATABASE_URL" node scripts/migrate.mjs plan --environment staging
\`\`\`

\`status\` and \`plan\` are read-only, identical inspections. They list applied
and pending versions and fail closed on drift. Do not apply to production
without explicit operator approval, a verified backup and a rehearsal.

For staging, create a backup using securely supplied PostgreSQL credentials,
verify it with \`pg_restore --list\`, record its restore location and timestamp,
and rehearse restoration on a disposable database:

\`\`\`bash
pg_dump -Fc --no-owner --no-acl -f /secure/staging-pre-migration.dump "$STAGING_DATABASE_URL"
pg_restore --list /secure/staging-pre-migration.dump
# After confirming the target database, the backup and the pending plan:
cd backend
YUUGEN_MIGRATION_TARGET=staging DATABASE_URL="$STAGING_DATABASE_URL" \
  node scripts/migrate.mjs apply --environment staging \
  --backup-file /secure/staging-pre-migration.dump --confirm-apply
\`\`\`

The CLI validates the local archive's magic header, minimum size and
24-hour freshness. **This is not proof of restoreability**: the operator
must separately verify \`pg_restore --list\`, perform a test restore, ensure
credentials and backup storage are protected, and check the selected database
is correct. Production uses \`--environment production\`,
\`YUUGEN_MIGRATION_TARGET=production\`, and its own verified backup, under
an approved maintenance/change window. Do not confuse an environment label
with a secure database identity check.

Never run the app with TypeORM schema synchronization enabled during this
procedure. Take a maintenance window before applying to a live system.

## Existing database / legacy migrations

The legacy installation may already have applied one or more of these SQL
files manually. The runner **does not guess** from table existence or use
\`CREATE TABLE IF NOT EXISTS\` as proof of correctness. On an old database,
first take a backup and compare the actual schema, indexes and constraints
with each SQL file in ordered sequence. If the schema is equivalent, an
operator must manually populate \`yuugen_schema_migrations\` with exact
verified checksums in order, inside a single exclusive change window.
Do not use the runner to mark unknown state as applied; do not run pending
DDL against valuable legacy data until the current state is reconciled.

An operator can derive checksums with \`sha256sum backend/migrations/*.sql\`.
If uncertain, restore the backup into a disposable database and validate there
first. A future dedicated audited baseline workflow is intentionally deferred.

## Rollback / recovery

A failed \`apply\` automatically rolls back its transaction. If commit succeeds
but a later application release fails, **do not delete ledger rows** or try
to reverse DDL blindly; SQL migrations are forward-only. Stop the backend,
restore the verified pre-migration backup into a *new* database instance, verify
application data and indexes and repoint staging traffic only after validation.
Coordinate a production recovery with owners because restoring a snapshot
would discard any post-backup writes. Keep the old database available for
forensic review. Rotate exposed database credentials through the approved
secret manager and update the database, deployment and app configuration
together; a Compose env edit does not change an initialized DB password.

## Required acceptance before closing #89

- Run \`node --test backend/scripts/migrate.test.mjs\` and \`make verify\`.
- Back up a representative legacy staging snapshot; verify \`pg_restore --list\`
  and restore it into a disposable Postgres 17 database.
- Reconcile any previously manually applied migrations and ledger checksums.
- Apply the full manifest, then apply again: second pass must execute zero DDL.
- Run two runner processes in parallel and confirm only one applies migrations.
- Inject a deliberately failing SQL migration *on disposable staging only* and
  confirm the ledger and schema both roll back.
- Validate actual table/column/index/constraint shape and zero data loss,
  including existing balances, moderation cases and roles.
- Test failed connection, lock timeout and checksum mismatch; rehearse
  restore and app rollback. Do not enable GitHub Actions or deploy to production.

**Known limitation:** No built-in baseline command for existing, manually
migrated databases, and backup verification is metadata-only. Keep the issue
open until staging recovery, legacy reconciliation and operator acceptance.
