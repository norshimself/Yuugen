import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createHash } from 'node:crypto';
import { mkdtemp, mkdir, writeFile, symlink, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { evaluateReleaseEvidence, REQUIRED_CHECKS, REQUIRED_APPROVALS,
  runReleaseGate } from './release-gate.mjs';

const COMMIT = 'a'.repeat(40);
const NOW = new Date('2026-10-31T00:00:00.000Z').getTime();
const DATE = new Date(NOW).toISOString();

async function fixture(t) {
  const dir = await mkdtemp(join(tmpdir(), 'yuugen-gate-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(join(dir, 'evidence'));
  async function file(label, body) {
    const artifact = 'evidence/' + label + '.log';
    await writeFile(join(dir, artifact), body);
    return { artifact, sha256: createHash('sha256').update(body).digest('hex'),
      performedAt: DATE };
  }
  const checks = [];
  for (const id of REQUIRED_CHECKS) checks.push({
    id, status: 'pass', ...await file('check-' + id, 'offline artifact ' + id),
  });
  const approvals = [];
  for (const [i, role] of REQUIRED_APPROVALS.entries()) approvals.push({
    role, reviewer: 'reviewer_' + (i + 1), ...await file('approval-' + role, role),
  });
  return { dir, file, manifest: {
    schemaVersion: 1, environment: 'disposable-staging', releaseSha: COMMIT,
    backendOrigin: 'https://api.staging.example.test',
    frontendOrigin: 'https://app.staging.example.test',
    disposableGuildId: '123456789012345678', checks, approvals,
  }};
}
function evaluate(f) {
  return evaluateReleaseEvidence(f.manifest, {
    expectedSha: COMMIT, baseDirectory: f.dir, now: NOW,
  });
}

test('explicit complete and fresh evidence with three independent reviewers passes', async (t) => {
  const f = await fixture(t);
  const result = await evaluate(f);
  assert.equal(result.passed, true);
  assert.equal(result.totalCount, REQUIRED_CHECKS.length + REQUIRED_APPROVALS.length);
  assert.equal(result.passedCount, result.totalCount);
  assert.ok(result.results.every(row => row.reason === null));
});

test('missing evidence and missing human approval do NOT imply green', async (t) => {
  const f = await fixture(t);
  f.manifest.checks.pop(); f.manifest.approvals.pop();
  const result = await evaluate(f);
  assert.equal(result.passed, false);
  assert.ok(result.results.some(row => row.reason === 'check_missing'));
  assert.ok(result.results.some(row => row.reason === 'approval_missing'));
});

test('blocked, failed, or not-run checks fail closed', async (t) => {
  const f = await fixture(t);
  for (const status of ['fail', 'blocked', 'not_run']) {
    f.manifest.checks[0].status = status;
    const result = await evaluate(f);
    assert.equal(result.passed, false);
    assert.equal(result.results[0].reason, status);
  }
});

test('invalid commit, missing SHA, and unrecognized manifest fields are rejected', async (t) => {
  const f = await fixture(t);
  await assert.rejects(() => evaluateReleaseEvidence(f.manifest, {
    expectedSha: 'b'.repeat(40), baseDirectory: f.dir, now: NOW,
  }), /commit/);
  f.manifest.secretAccessToken = 'must-not-be-accepted';
  await assert.rejects(() => evaluate(f), /manifest fields/);
});

test('production, HTTP, credentialed and redirect URL metadata is rejected', async (t) => {
  const f = await fixture(t);
  for (const url of [
    'https://api.example.com', 'http://api.staging.example.test',
    'https://user:password@api.staging.example.test',
    'https://api.staging.example.test/path',
    'https://api.staging.example.test/?access_token=secret',
    'https://api.staging.example.test:8443',
  ]) {
    f.manifest.backendOrigin = url;
    await assert.rejects(() => evaluate(f), /staging environment/);
  }
});

test('bad or modified evidence bytes fail SHA-256 integrity checks', async (t) => {
  const f = await fixture(t);
  f.manifest.checks[0].sha256 = 'b'.repeat(64);
  let result = await evaluate(f);
  assert.equal(result.results[0].reason, 'artifact_digest_mismatch');
  const original = f.manifest.checks[1];
  await writeFile(join(f.dir, original.artifact), 'tampered after run');
  result = await evaluate(f);
  assert.equal(result.results[1].reason, 'artifact_digest_mismatch');
});

test('stale and future results cannot promote a release', async (t) => {
  const f = await fixture(t);
  f.manifest.checks[0].performedAt = '2026-09-01T00:00:00.000Z';
  f.manifest.approvals[0].performedAt = '2026-11-02T00:00:00.000Z';
  const result = await evaluate(f);
  assert.equal(result.passed, false);
  assert.equal(result.results[0].reason, 'stale_or_missing_timestamp');
  assert.equal(result.results.at(-3).reason, 'stale_or_missing_timestamp');
});

test('traversal and outside symlink artifacts cannot be used as evidence', async (t) => {
  const f = await fixture(t);
  f.manifest.checks[0].artifact = 'evidence/../outside.log';
  let result = await evaluate(f);
  assert.equal(result.results[0].reason, 'unsafe_artifact_path');
  const dirOutside = await mkdtemp(join(tmpdir(), 'yuugen-outside-'));
  t.after(() => rm(dirOutside, { recursive: true, force: true }));
  await writeFile(join(dirOutside, 'token.txt'), 'never-read-me');
  await symlink(join(dirOutside, 'token.txt'), join(f.dir, 'evidence', 'link.log'));
  f.manifest.checks[0].artifact = 'evidence/link.log';
  result = await evaluate(f);
  assert.equal(result.results[0].reason, 'unsafe_artifact_path');
});

test('duplicate checks, unknown IDs and duplicate human reviewers are rejected', async (t) => {
  const f = await fixture(t);
  f.manifest.checks.push({ ...f.manifest.checks[0] });
  await assert.rejects(() => evaluate(f), /duplicate/);
  f.manifest.checks.pop();
  f.manifest.checks[0].id = 'deploy_to_production';
  await assert.rejects(() => evaluate(f), /Unknown/);
  f.manifest.checks[0].id = REQUIRED_CHECKS[0];
  f.manifest.approvals[1].reviewer = f.manifest.approvals[0].reviewer;
  await assert.rejects(() => evaluate(f), /human review/);
});

test('CLI returns only fixed pass/block labels, never artifact content or secrets', async (t) => {
  const f = await fixture(t);
  const path = join(f.dir, 'release-evidence.json');
  await writeFile(path, JSON.stringify(f.manifest));
  const output = [];
  const original = Date.now;
  Date.now = () => NOW;
  try {
    const ok = await runReleaseGate([path, '--commit', COMMIT], msg => output.push(msg));
    assert.equal(ok, true);
    assert.match(output.at(-1), /eligible for independent promotion approval/);
    assert.ok(!output.join('\n').includes('offline artifact'));
    assert.ok(!output.join('\n').includes(f.manifest.backendOrigin));
    assert.ok(!output.join('\n').includes('reviewer_1'));
  } finally { Date.now = original; }
});

test('source-controlled evidence template is always blocked and has every check ID', async () => {
  const template = JSON.parse(await readFile(
    new URL('../docs/release-evidence.template.json', import.meta.url), 'utf8',
  ));
  assert.deepEqual(template.checks.map(item => item.id), REQUIRED_CHECKS);
  assert.ok(template.checks.every(item => item.status === 'not_run' &&
    item.artifact === null && item.sha256 === null && item.performedAt === null));
  assert.deepEqual(template.approvals, []);
  assert.notEqual(template.releaseSha, COMMIT);
});

test('bad JSON parser errors never echo untrusted JSON or potential secrets', async (t) => {
  const f = await fixture(t);
  const path = join(f.dir, 'release-evidence.json');
  await writeFile(path, '{"oauth_code":"very-secret-grant", broken JSON');
  await assert.rejects(
    () => runReleaseGate([path, '--commit', COMMIT], () => {}),
    /^Error: Cannot read valid local release evidence JSON$/,
  );
});
