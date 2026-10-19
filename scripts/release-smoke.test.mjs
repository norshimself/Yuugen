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

test('exercises the real HTTP transport against an isolated local server', async (t) => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    const route = req.url || '';
    let status = 401;
    if (route === '/api/v1/status') status = 200;
    if (route === '/api/v1/auth/refresh' && !req.headers['x-yuugen-client']) {
      status = 403;
    }
    if (route === '/api/v1/auth/exchange' && req.headers.origin) {
      status = 403;
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end('{}');
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const address = server.address();
  assert.equal(typeof address, 'object');
  const ok = await runSmoke(
    'http://127.0.0.1:' + address.port + '/api/v1',
    fetch,
    () => {},
  );
  assert.equal(ok, true);
});
