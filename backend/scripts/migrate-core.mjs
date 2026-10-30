import { createHash } from 'node:crypto';
import { readFile, readdir, open } from 'node:fs/promises';

export const MIGRATION_DIRECTORY = new URL('../migrations/', import.meta.url);
const LEDGER = 'public.yuugen_schema_migrations';
const MIGRATION_NAME = /^\d{8}_[a-z][a-z0-9_]*\.sql$/;

/**
 * Existing Yuugen SQL files have BEGIN/COMMIT wrappers. They must be removed
 * before execution inside the runner's single transaction: an inner COMMIT
 * would otherwise commit the schema before its ledger entry is recorded.
 */
export function unwrapMigration(sql, filename = 'migration.sql') {
  const match = /^(?:\s|--[^\n]*(?:\n|$))*BEGIN\s*;\s*([\s\S]*?)\s*COMMIT\s*;\s*$/i.exec(sql);
  if (!match || !match[1].trim()) {
    throw new Error(filename + ': expected exactly one outer BEGIN; ... COMMIT; wrapper');
  }
  const body = match[1].trim();
  if (/(^|\n)\s*(BEGIN|COMMIT|END|ROLLBACK|SAVEPOINT|RELEASE)\s*;/i.test(body)) {
    throw new Error(filename + ': nested transaction commands are not supported');
  }
  return body;
}

export async function loadMigrations(directory = MIGRATION_DIRECTORY) {
  const manifest = JSON.parse(await readFile(new URL('manifest.json', directory), 'utf8'));
  const names = manifest.migrations;
  if (manifest.version !== 1 || !Array.isArray(names) || !names.length ||
      !names.every((name) => typeof name === 'string' && MIGRATION_NAME.test(name)) ||
      new Set(names).size !== names.length) {
    throw new Error('Invalid migrations/manifest.json (version, names or duplicates)');
  }
  const discovered = (await readdir(directory)).filter((name) => name.endsWith('.sql'));
  if (discovered.length !== names.length || discovered.some((name) => !names.includes(name))) {
    throw new Error('Unregistered SQL migration: update migrations/manifest.json explicitly');
  }
  return Promise.all(names.map(async (name) => {
    const source = await readFile(new URL(name, directory), 'utf8');
    return {
      name,
      checksum: createHash('sha256').update(source, 'utf8').digest('hex'),
      sql: unwrapMigration(source, name),
    };
  }));
}

/** Fail closed on unknown migrations, checksum drift and non-prefix histories. */
export function reconcileMigrations(migrations, appliedRows) {
  const byName = new Map(migrations.map((entry, index) => [entry.name, { ...entry, index }]));
  const seen = new Set();
  for (const row of appliedRows) {
    const entry = byName.get(row.name);
    if (!entry || seen.has(row.name)) {
      throw new Error('Unexpected or duplicate recorded migration: ' + row.name);
    }
    if (entry.checksum !== row.checksum) {
      throw new Error('Checksum mismatch for applied migration: ' + row.name);
    }
    seen.add(row.name);
  }
  let pendingFound = false;
  return migrations.map((entry) => {
    const applied = seen.has(entry.name);
    if (!applied) pendingFound = true;
    if (applied && pendingFound) {
      throw new Error('Out-of-order migration history: ' + entry.name);
    }
    return { ...entry, applied };
  });
}

export async function inspectMigrations(client, migrations) {
  const exists = await client.query(
    "SELECT to_regclass('public.yuugen_schema_migrations') IS NOT NULL AS exists",
  );
  const rows = exists.rows[0].exists
    ? (await client.query('SELECT name, checksum FROM ' + LEDGER)).rows
    : [];
  return reconcileMigrations(migrations, rows);
}

/**
 * All DDL and the version ledger commit atomically under a transaction-scoped
 * advisory lock. A second worker must wait, then see the first one's ledger.
 * No SQL or DDL is executed by inspectMigrations alone.
 */
export async function applyMigrations(client, migrations, onApplied = () => {}) {
  await client.query('BEGIN');
  try {
    await client.query("SET LOCAL lock_timeout = '10s'");
    await client.query("SET LOCAL statement_timeout = '120s'");
    await client.query('SELECT pg_advisory_xact_lock(202610, 89)');
    await client.query(
      'CREATE TABLE IF NOT EXISTS ' + LEDGER + ' (' +
      'name VARCHAR(255) PRIMARY KEY, ' +
      'checksum CHAR(64) NOT NULL, ' +
      'applied_at TIMESTAMPTZ NOT NULL DEFAULT now())',
    );
    const plan = await inspectMigrations(client, migrations);
    const pending = plan.filter((entry) => !entry.applied);
    for (const entry of pending) {
      await client.query(entry.sql);
      await client.query(
        'INSERT INTO ' + LEDGER + ' (name, checksum) VALUES ($1, $2)',
        [entry.name, entry.checksum],
      );
      onApplied(entry.name);
    }
    await client.query('COMMIT');
    return pending.map((entry) => entry.name);
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch {
      // Preserve the original migration failure.
    }
    throw error;
  }
}

/** A fresh nonempty pg_dump custom archive is required before staging/prod. */
export async function verifyBackupFile(filename, now = Date.now()) {
  if (!filename) throw new Error('A --backup-file custom-format pg_dump is required');
  const handle = await open(filename, 'r');
  try {
    const info = await handle.stat();
    if (!info.isFile() || info.size < 1024) {
      throw new Error('Backup must be a nonempty regular pg_dump archive');
    }
    if (info.mtimeMs > now + 5 * 60_000 || now - info.mtimeMs > 24 * 60 * 60_000) {
      throw new Error('Backup must be from the last 24 hours');
    }
    const magic = Buffer.alloc(5);
    const result = await handle.read(magic, 0, magic.length, 0);
    if (result.bytesRead !== 5 || magic.toString('ascii') !== 'PGDMP') {
      throw new Error('Backup must be a pg_dump -Fc custom-format archive');
    }
    return info.size;
  } finally {
    await handle.close();
  }
}
