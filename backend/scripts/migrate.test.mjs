import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, writeFile, utimes, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from './migrate.mjs';
import {
  loadMigrations, unwrapMigration, reconcileMigrations,
  inspectMigrations, applyMigrations, verifyBackupFile,
} from './migrate-core.mjs';

const sample = (name, checksum = 'abc') => ({ name, checksum, sql: 'SELECT 1;' });

test('manifest loads the seven main-branch migrations in dependency order', async () => {
  const migrations = await loadMigrations();
  assert.equal(migrations.length, 7);
  assert.equal(migrations[0].name, '20261019_economy_integrity.sql');
  assert.equal(migrations.at(-1).name, '20261028_automod_rules.sql');
  assert.equal(new Set(migrations.map((entry) => entry.checksum)).size, 7);
});

test('only outer transaction wrappers are removed', () => {
  assert.equal(unwrapMigration('-- header\nBEGIN;\nSELECT 1;\nCOMMIT;'), 'SELECT 1;');
  assert.throws(() => unwrapMigration('SELECT 1'), /expected exactly one outer/);
  assert.throws(() => unwrapMigration('BEGIN; SAVEPOINT;\nCOMMIT;'), /nested transaction/);
});

test('manifest does not silently omit or permit unknown SQL', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yuugen-migration-'));
  try {
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({version: 1, migrations: ['20261020_good.sql']}));
    await writeFile(join(dir, '20261020_good.sql'), 'BEGIN; SELECT 1; COMMIT;');
    await writeFile(join(dir, '20261021_extra.sql'), 'BEGIN; SELECT 2; COMMIT;');
    await assert.rejects(() => loadMigrations(pathToFileURL(dir + '/')), /Unregistered SQL/);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test('reconcile rejects checksum edits, unknown rows, duplicates and gaps', () => {
  const files = [sample('one'), sample('two')];
  assert.deepEqual(reconcileMigrations(files, [{name:'one', checksum:'abc'}]).map(x => x.applied), [true,false]);
  assert.throws(() => reconcileMigrations(files, [{name:'one',checksum:'changed'}]), /Checksum mismatch/);
  assert.throws(() => reconcileMigrations(files, [{name:'unknown',checksum:'abc'}]), /Unexpected/);
  assert.throws(() => reconcileMigrations(files, [{name:'one',checksum:'abc'}, {name:'one',checksum:'abc'}]), /duplicate/);
  assert.throws(() => reconcileMigrations(files, [{name:'two',checksum:'abc'}]), /Out-of-order/);
});

test('inspection is read-only, including when the ledger does not exist', async () => {
  const commands = [];
  const client = { query: async (sql) => {
    commands.push(sql);
    return {rows: [{exists:false}]};
  }};
  assert.equal((await inspectMigrations(client, [sample('one')]))[0].applied, false);
  assert.equal(commands.length, 1);
  assert.match(commands[0], /to_regclass/);
});

test('apply reserves a transaction lock and records each migration exactly once', async () => {
  const queries = [];
  const client = { query: async (sql, params) => {
    queries.push({sql, params});
    if (sql.includes('to_regclass')) return {rows: [{exists:true}]};
    if (sql.startsWith('SELECT name')) return {rows: [{name:'one',checksum:'abc'}]};
    return {rows: []};
  }};
  assert.deepEqual(await applyMigrations(client, [sample('one'), sample('two')]), ['two']);
  assert.equal(queries[0].sql, 'BEGIN');
  assert.ok(queries.some(q => q.sql.includes('pg_advisory_xact_lock')));
  assert.deepEqual(queries.find(q => q.sql.includes('INSERT INTO')).params, ['two','abc']);
  assert.equal(queries.at(-1).sql, 'COMMIT');
  assert.equal(queries.filter(q => q.sql === 'SELECT 1;').length, 1);
});

test('failure rolls back and never commits incomplete ledger writes', async () => {
  const queries = [];
  const client = {query: async (sql) => {
    queries.push(sql);
    if (sql.includes('to_regclass')) return {rows:[{exists:true}]};
    if (sql.startsWith('SELECT name')) return {rows:[]};
    if (sql === 'SELECT broken;') throw new Error('SQL failed');
    return {rows:[]};
  }};
  await assert.rejects(() => applyMigrations(client, [sample('one', 'abc'), { ...sample('two'), sql:'SELECT broken;' }]), /SQL failed/);
  assert.equal(queries.at(-1), 'ROLLBACK');
  assert.ok(!queries.includes('COMMIT'));
});

test('environment and confirmation flags are parsed explicitly', () => {
  assert.deepEqual(parseArgs(['status']), {command:'status',environment:'local',backupFile:null,confirmApply:false});
  assert.equal(parseArgs(['apply','--environment','staging','--backup-file','/tmp/backup','--confirm-apply']).environment,'staging');
  assert.throws(() => parseArgs(['apply','--bad']), /Unknown/);
  assert.throws(() => parseArgs(['apply','--environment','other']), /Invalid/);
});

test('backup requires a recent nonempty pg_dump custom archive', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'yuugen-backup-'));
  const file = join(dir,'backup.dump');
  try {
    await writeFile(file, Buffer.concat([Buffer.from('PGDMP'), Buffer.alloc(1100)]));
    assert.ok(await verifyBackupFile(file) > 1024);
    await utimes(file, new Date(0), new Date(0));
    await assert.rejects(() => verifyBackupFile(file), /last 24 hours/);
  } finally {
    await rm(dir, {recursive:true,force:true});
  }
});
