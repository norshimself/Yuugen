#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { loadMigrations, inspectMigrations, applyMigrations, verifyBackupFile } from './migrate-core.mjs';

export function parseArgs(argv) {
  const [command, ...args] = argv;
  if (!['status', 'plan', 'apply'].includes(command)) {
    throw new Error('Usage: node scripts/migrate.mjs status|plan|apply [--environment local|staging|production] [--backup-file PATH] [--confirm-apply]');
  }
  const flags = { environment: 'local', backupFile: null, confirmApply: false };
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--environment' && args[i + 1]) flags.environment = args[++i];
    else if (args[i] === '--backup-file' && args[i + 1]) flags.backupFile = args[++i];
    else if (args[i] === '--confirm-apply') flags.confirmApply = true;
    else throw new Error('Unknown/incomplete argument: ' + args[i]);
  }
  if (!['local', 'staging', 'production'].includes(flags.environment)) {
    throw new Error('Invalid --environment');
  }
  return { command, ...flags };
}

export async function run(argv = process.argv.slice(2), env = process.env, logger = console.log) {
  const options = parseArgs(argv);
  const migrations = await loadMigrations();
  const databaseUrl = env.DATABASE_URL;
  if (!databaseUrl) throw new Error('DATABASE_URL is required');
  const parsed = new URL(databaseUrl);
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('DATABASE_URL must be a PostgreSQL URL');
  }
  if (options.command === 'apply') {
    if (!options.confirmApply) throw new Error('apply requires --confirm-apply');
    if (options.environment !== 'local') {
      await verifyBackupFile(options.backupFile);
      if (env.YUUGEN_MIGRATION_TARGET !== options.environment) {
        throw new Error('Set YUUGEN_MIGRATION_TARGET to the confirmed environment');
      }
    }
  } else if (options.confirmApply || options.backupFile) {
    throw new Error('Write-only flags require apply');
  }
  // No DB credentials or SQL are printed.
  const { Client } = await import('pg');
  const client = new Client({ connectionString: databaseUrl, connectionTimeoutMillis: 10000 });
  await client.connect();
  try {
    const plan = options.command === 'apply'
      ? null
      : await inspectMigrations(client, migrations);
    if (plan) {
      for (const item of plan) {
        logger((item.applied ? 'APPLIED ' : 'PENDING ') + item.name);
      }
      logger(plan.filter((item) => !item.applied).length + ' pending');
    } else {
      const applied = await applyMigrations(client, migrations);
      logger('Committed ' + applied.length + ' migrations: ' + applied.join(', '));
    }
  } finally {
    await client.end();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  run().catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
