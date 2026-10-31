import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { unwrapMigration } from './migrate-core.mjs';

const sqlPath = fileURLToPath(new URL('../migrations/20261030_scheduled_jobs.sql', import.meta.url));
const manifestPath = fileURLToPath(new URL('../migrations/manifest.json', import.meta.url));

/**
 * Minimal SQL delimiter scan, NOT a PostgreSQL parser. Quoted strings,
 * quoted identifiers and comments are masked before counting SQL wrappers.
 * The real disposable-Postgres suite remains required before deployment.
 */
function examineSql(sql) {
  let masked = '';
  let state = 'code';
  let nesting = 0;
  let line = 1;
  for (let i = 0; i < sql.length; i++) {
    const ch = sql[i];
    const next = sql[i + 1];
    if (ch === '\n') line++;
    if (state === 'line') {
      masked += ch === '\n' ? '\n' : ' ';
      if (ch === '\n') state = 'code';
      continue;
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') {
        masked += '  '; i++; state = 'code';
      } else masked += ch === '\n' ? '\n' : ' ';
      continue;
    }
    if (state === 'single' || state === 'double') {
      const quote = state === 'single' ? "'" : '"';
      if (ch === quote && next === quote) {
        masked += '  '; i++; continue;
      }
      masked += ch === '\n' ? '\n' : ' ';
      if (ch === quote) state = 'code';
      continue;
    }
    if (ch === '-' && next === '-') {
      masked += '  '; i++; state = 'line'; continue;
    }
    if (ch === '/' && next === '*') {
      masked += '  '; i++; state = 'block'; continue;
    }
    if (ch === "'" || ch === '"') {
      masked += ' ';
      state = ch === "'" ? 'single' : 'double';
      continue;
    }
    if (ch === '(') nesting++;
    if (ch === ')') {
      nesting--;
      if (nesting < 0) throw new Error('Unexpected closing SQL parenthesis at line ' + line);
    }
    masked += ch;
  }
  if (state !== 'code' && state !== 'line') {
    throw new Error('Unterminated SQL string, identifier or comment');
  }
  if (nesting !== 0) throw new Error('Unbalanced SQL parentheses');
  return masked;
}

test('scheduler migration has valid statement boundaries and no repeated DDL', async () => {
  const sql = await readFile(sqlPath, 'utf8');
  const masked = examineSql(sql);
  assert.equal((masked.match(/\bBEGIN\s*;/gi) || []).length, 1);
  assert.equal((masked.match(/\bCOMMIT\s*;/gi) || []).length, 1);
  assert.equal((masked.match(/\bROLLBACK\s*;/gi) || []).length, 0);
  assert.equal((masked.match(/\bCREATE\s+TABLE\s+IF\s+NOT\s+EXISTS\b/gi) || []).length, 2);
  assert.equal((masked.match(/\bCREATE\s+INDEX\s+IF\s+NOT\s+EXISTS\b/gi) || []).length, 5);
  assert.ok(masked.indexOf('BEGIN;') < masked.indexOf('CREATE TABLE'));
  assert.ok(masked.lastIndexOf('COMMIT;') > masked.lastIndexOf('CREATE INDEX'));
});

test('runner accepts exactly this schema and manifest registers it last', async () => {
  const sql = await readFile(sqlPath, 'utf8');
  const body = unwrapMigration(sql);
  assert.match(body, /CREATE TABLE IF NOT EXISTS "scheduled_jobs"/);
  assert.match(body, /CREATE TABLE IF NOT EXISTS "scheduled_job_events"/);
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.migrations.at(-1), '20261030_scheduled_jobs.sql');
  assert.equal(manifest.migrations.filter((n) => n === '20261030_scheduled_jobs.sql').length, 1);
});

test('database contract guards kind, identities, leases, audit and claim index', async () => {
  const sql = await readFile(sqlPath, 'utf8');
  for (const required of [
    'CONSTRAINT "UQ_scheduled_jobs_guild_kind_idempotency"',
    'CONSTRAINT "CHK_scheduled_jobs_guild_id"',
    'CONSTRAINT "CHK_scheduled_jobs_kind"',
    'CONSTRAINT "CHK_scheduled_jobs_idempotency_key"',
    'CONSTRAINT "CHK_scheduled_jobs_attempts"',
    'CONSTRAINT "CHK_scheduled_jobs_status"',
    'CONSTRAINT "CHK_scheduled_jobs_lease"',
    'CONSTRAINT "CHK_scheduled_jobs_payload"',
    'CREATE INDEX IF NOT EXISTS "IDX_scheduled_jobs_pending_kind_due"',
    'CREATE INDEX IF NOT EXISTS "IDX_scheduled_jobs_lease_expiry"',
    'CREATE TABLE IF NOT EXISTS "scheduled_job_events"',
    'CONSTRAINT "CHK_scheduled_job_events_event"',
  ]) {
    assert.ok(sql.includes(required), 'Missing SQL contract: ' + required);
  }
  assert.match(sql, /"jobId" BIGINT NOT NULL REFERENCES "scheduled_jobs"/);
  assert.match(sql, /'manual_resolved'/);
  assert.match(sql, /'released_unstarted'/);
  assert.match(sql, /"kind", "runAt", "id"\) WHERE "status" = 'pending'/);
});

test('static scanner catches the malformed/duplicated migration regression', () => {
  assert.throws(() => examineSql("BEGIN; CREATE TABLE t (id int)); COMMIT;"), /closing/);
  assert.throws(() => examineSql("BEGIN; CREATE TABLE t (txt text DEFAULT 'unterminated"), /Unterminated/);
  assert.throws(() => examineSql('BEGIN; CREATE TABLE t (id int; COMMIT;'), /Unbalanced/);
});
