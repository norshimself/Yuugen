import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probes, runSmoke } from './release-smoke.mjs';

test('all expected auth and health statuses pass', async () => {
  const messages = [];
  let index = 0;
  const result = await runSmoke(
    'http://localhost:3001/api/v1',
    async () => ({ status: probes[index++].status }),
    (message) => messages.push(message),
  );
  assert.equal(result, true);
  assert.match(messages.at(-1), new RegExp(`^${probes.length}/${probes.length}`));
});

test('failing unauthorized endpoint fails release check', async () => {
  const result = await runSmoke(
    'http://localhost:3001/api/v1',
    async () => ({ status: 200 }),
    () => {},
  );
  assert.equal(result, false);
});

test('rejects malformed targets instead of probing arbitrary URLs', async () => {
  await assert.rejects(
    () => runSmoke('https://user:token@example.com/api/v1', async () => ({})),
    /must be an HTTP\(S\) URL/,
  );
  await assert.rejects(
    () => runSmoke('ftp://example.com/api/v1', async () => ({})),
    /must be an HTTP\(S\) URL/,
  );
});
