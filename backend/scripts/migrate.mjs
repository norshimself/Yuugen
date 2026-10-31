#!/usr/bin/env node
import { pathToFileURL } from 'node:url';
import { loadMigrations, inspectMigrations, applyMigrations, verifyBackupFile } from './migrate-core.mjs';

export function parseArgs(argv) {
  const [command, ...args] = argv;
  if (!['status', 'plan', 'apply'].includes(command)) {
    throw new Error('Usage: node scripts/migrate.mjs status|plan|apply [--environment local|staging|production] [--backup-file PATH] [--confirm-apply]');
  }
  const flags = { environment: null, backupFile: null, confirmApply: false };
  const seen = new Set();
  for (let i = 0; i < args.length; i++) {
    const flag = args[i];
    if (seen.has(flag)) throw new Error('Repeated flag: ' + flag);
    seen.add(flag);
    if (flag === '--confirm-apply') {
      flags.confirmApply = true;
    } else if (flag === '--environment' || flag === '--backup-file') {
      if (!args[i + 1] || args[i + 1].startsWith('--')) {
        throw new Error('Missing value for ' + flag);
      }
      const value = args[++i];
      if (flag === '--environment') flags.environment = value;
      else flags.backupFile = value;
    } else {
      throw new Error('Unknown argument: ' + flag);
    }
  }
  if (flags.environment && !['local', 'staging', 'production'].includes(flags.environment)) {
    throw new Error('Invalid --environment');
  }
  if (command !== 'apply' && (flags.confirmApply || flags.backupFile)) {
    throw new Error('Write-only flags require apply');
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
    if (!options.environment) throw new Error('apply requires explicit --environment');
    if (!options.confirmApply) throw new Error('apply requires --confirm-apply');
    if (env.YUUGEN_MIGRATION_TARGET !== options.environment) {
      throw new Error('Set YUUGEN_MIGRATION_TARGET to the confirmed environment');
    }
    if (options.environment === 'local' &&
        (env.NODE_ENV === 'production' ||
         !['localhost', '127.0.0.1', '[::1]', 'postgres'].includes(parsed.hostname))) {
      throw new Error('local apply requires a local database and non-production NODE_ENV');
    }
    if (options.environment !== 'local') {
      await verifyBackupFile(options.backupFile);
    }
  } else if (options.confirmApply || options.backupFile) {
    throw new Error('Write-only flags require apply');
  }
  // No DB credentials or SQL are printed.
  const { Client } = (await import('pg')).default;
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
