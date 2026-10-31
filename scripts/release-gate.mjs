/**
 * Manual, fail-closed staging release decision from local evidence ONLY (#92).
 * No HTTP calls, shell commands, deployments, migrations or token access.
 * Evidence metadata is not a signature: staff must independently review it.
 */
import { createHash } from 'node:crypto';
import { readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

export const REQUIRED_CHECKS = Object.freeze([
  'offline_tool_tests', 'backend_npm_install_build', 'backend_jest',
  'backend_e2e', 'frontend_npm_install_build', 'compose_config',
  'staging_database_backup', 'staging_migration_rehearsal',
  'database_restore_rehearsal', 'frontend_preview_https',
  'backend_https_wss', 'oauth_refresh_logout', 'api_smoke_readiness',
  'authenticated_guild_checks', 'discord_voice_lavalink',
  'moderation_permissions', 'dependency_outage_behavior',
  'rollback_rehearsal', 'metrics_logs_redaction',
]);
export const REQUIRED_APPROVALS = Object.freeze([
  'backend_owner', 'staging_operator', 'security_reviewer',
]);
const SHA = /^[0-9a-f]{40}$/i;
const DIGEST = /^[0-9a-f]{64}$/i;
const ARTIFACT = /^evidence\/[A-Za-z0-9._/-]{1,160}$/;
const REVIEWER = /^[A-Za-z0-9._-]{3,80}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const FRESHNESS_MS = 14 * 24 * 60 * 60 * 1000;
const FUTURE_SKEW_MS = 5 * 60 * 1000;
const MAX_EVIDENCE_BYTES = 8 * 1024 * 1024;

function object(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}
function hasExactKeys(value, keys) {
  return object(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
}
function stagingOrigin(value) {
  if (typeof value !== 'string') return false;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && !url.username && !url.password &&
      !url.search && !url.hash && url.pathname === '/' &&
      url.port === '' && url.origin === value &&
      /(^|[.-])(staging|stage|test|dev)([.-]|$)/i.test(url.hostname);
  } catch { return false; }
}
function fresh(value, now) {
  if (typeof value !== 'string' || !ISO.test(value)) return false;
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) && timestamp <= now + FUTURE_SKEW_MS &&
    now - timestamp <= FRESHNESS_MS;
}
function safeArtifactPath(value) {
  if (typeof value !== 'string' || !ARTIFACT.test(value) || isAbsolute(value) ||
      value.split('/').some(part => part === '..' || part === '.' || !part) ||
      value.includes('\\')) return false;
  return true;
}
async function verifyArtifact(base, descriptor) {
  if (!safeArtifactPath(descriptor.artifact)) return 'unsafe_artifact_path';
  if (typeof descriptor.sha256 !== 'string' || !DIGEST.test(descriptor.sha256)) {
    return 'missing_artifact_digest';
  }
  try {
    const root = await realpath(base);
    const target = await realpath(join(root, descriptor.artifact));
    const inside = relative(root, target);
    if (!inside || inside.startsWith('..' + sep) || inside === '..' ||
        isAbsolute(inside)) return 'unsafe_artifact_path';
    const info = await stat(target);
    if (!info.isFile() || info.size < 1 || info.size > MAX_EVIDENCE_BYTES) {
      return 'invalid_artifact_file';
    }
    const digest = createHash('sha256').update(await readFile(target)).digest('hex');
    return digest.toLowerCase() === descriptor.sha256.toLowerCase()
      ? null : 'artifact_digest_mismatch';
  } catch { return 'artifact_not_readable'; }
}

/** Only fixed check identifiers/statuses are printed, never evidence contents. */
export async function evaluateReleaseEvidence(manifest, {
  expectedSha, baseDirectory, now = Date.now(),
} = {}) {
  if (!hasExactKeys(manifest, [
    'schemaVersion', 'environment', 'releaseSha', 'backendOrigin',
    'frontendOrigin', 'disposableGuildId', 'checks', 'approvals',
  ])) throw new Error('Invalid release evidence manifest fields');
  if (manifest.schemaVersion !== 1 || manifest.environment !== 'disposable-staging' ||
      typeof expectedSha !== 'string' || !SHA.test(expectedSha) ||
      !SHA.test(manifest.releaseSha) || manifest.releaseSha !== expectedSha) {
    throw new Error('Invalid or mismatched release commit');
  }
  if (!stagingOrigin(manifest.backendOrigin) ||
      !stagingOrigin(manifest.frontendOrigin) ||
      manifest.backendOrigin === manifest.frontendOrigin ||
      typeof manifest.disposableGuildId !== 'string' ||
      !/^\d{17,20}$/.test(manifest.disposableGuildId)) {
    throw new Error('Invalid disposable staging environment metadata');
  }
  if (!baseDirectory || !Array.isArray(manifest.checks) ||
      !Array.isArray(manifest.approvals)) {
    throw new Error('Missing local evidence directory or entries');
  }
  const checkIds = new Set(REQUIRED_CHECKS);
  const checks = new Map();
  for (const item of manifest.checks) {
    if (!hasExactKeys(item, ['id', 'status', 'artifact', 'sha256', 'performedAt']) ||
        !checkIds.has(item.id) || checks.has(item.id) ||
        !['pass', 'fail', 'blocked', 'not_run'].includes(item.status)) {
      throw new Error('Unknown, duplicate or malformed release check');
    }
    checks.set(item.id, item);
  }
  const results = [];
  for (const id of REQUIRED_CHECKS) {
    const item = checks.get(id);
    let reason = null;
    if (!item) reason = 'check_missing';
    else if (item.status !== 'pass') reason = item.status;
    else if (!fresh(item.performedAt, now)) reason = 'stale_or_missing_timestamp';
    else reason = await verifyArtifact(baseDirectory, item);
    results.push({ id, passed: reason === null, reason });
  }
  const roles = new Set(REQUIRED_APPROVALS);
  const approvals = new Map();
  const people = new Set();
  for (const item of manifest.approvals) {
    if (!hasExactKeys(item, ['role', 'reviewer', 'artifact', 'sha256', 'performedAt']) ||
        !roles.has(item.role) || approvals.has(item.role) ||
        typeof item.reviewer !== 'string' || !REVIEWER.test(item.reviewer) ||
        people.has(item.reviewer.toLowerCase())) {
      throw new Error('Duplicate, unrecognized or malformed human review');
    }
    approvals.set(item.role, item);
    people.add(item.reviewer.toLowerCase());
  }
  for (const role of REQUIRED_APPROVALS) {
    const item = approvals.get(role);
    let reason = null;
    if (!item) reason = 'approval_missing';
    else if (!fresh(item.performedAt, now)) reason = 'stale_or_missing_timestamp';
    else reason = await verifyArtifact(baseDirectory, item);
    results.push({ id: 'approval_' + role, passed: reason === null, reason });
  }
  return {
    passed: results.every(row => row.passed),
    passedCount: results.filter(row => row.passed).length,
    totalCount: results.length,
    results,
  };
}

export async function runReleaseGate(argv = process.argv.slice(2), log = console.log) {
  if (argv.length !== 3 || argv[1] !== '--commit' || !SHA.test(argv[2])) {
    throw new Error('Usage: node scripts/release-gate.mjs <local-evidence.json> --commit <40-hex-sha>');
  }
  const manifest = JSON.parse(await readFile(argv[0], 'utf8'));
  const decision = await evaluateReleaseEvidence(manifest, {
    expectedSha: argv[2], baseDirectory: dirname(await realpath(argv[0])),
  });
  for (const entry of decision.results) {
    log((entry.passed ? 'PASS' : 'BLOCK') + ' ' + entry.id +
        (entry.reason ? ' (' + entry.reason + ')' : ''));
  }
  log('Manual staging release gate: ' + decision.passedCount + '/' +
      decision.totalCount + ' verified; ' +
      (decision.passed ? 'eligible for independent promotion approval' : 'NOT RELEASE READY'));
  return decision.passed;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const passed = await runReleaseGate();
    if (!passed) process.exitCode = 1;
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Invalid release evidence');
    process.exitCode = 2;
  }
}
