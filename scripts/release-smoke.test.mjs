import assert from 'node:assert/strict';
import { test } from 'node:test';
import { probes, runSmoke } from './release-smoke.mjs';

const ready = {
  status: 'ready',
  dependencies: { database: 'up', discord: 'up', lavalink: 'up' },
};

test('all expected auth and health statuses pass', async () => {
  const messages = [];
  let index = 0;
  const result = await runSmoke(
    'http://localhost:3001/api/v1',
    async () => ({ status: probes[index++].status, json: async () => ready }),
    (message) => messages.push(message),
  );
  assert.equal(result, true);
  assert.match(messages.at(-1), new RegExp(`^${probes.length}/${probes.length}`));
});

test('failing unauthorized endpoint fails release check', async () => {
  const result = await runSmoke(
    'http://localhost:3001/api/v1',
    async () => ({ status: 200, json: async () => ready }),
    () => {},
  );
  assert.equal(result, false);
});

test('200 with an unhealthy dependency fails the release check', async () => {
  let index = 0;
  const messages = [];
  const ok = await runSmoke(
    'http://localhost:3001/api/v1',
    async () => ({
      status: probes[index++].status,
      json: async () => ({
        status: 'ready',
        dependencies: { ...ready.dependencies, lavalink: 'down' },
      }),
    }),
    (message) => messages.push(message),
  );
  assert.equal(ok, false);
  assert.ok(messages.some((line) => line.includes('FAIL Postgres, Discord and Lavalink ready')));
});

test('HTTP 503 dependency outage must block a release even if liveness is fine', async () => {
  let index = 0;
  const lines = [];
  const ok = await runSmoke(
    'https://api.staging.example.test/api/v1',
    async () => {
      const probe = probes[index++];
      if (probe.path === '/ready') return {
        status: 503,
        json: async () => ({
          status: 'unavailable',
          dependencies: { database: 'down', discord: 'up', lavalink: 'up' },
        }),
      };
      return { status: probe.status, json: async () => ready };
    },
    line => lines.push(line),
  );
  assert.equal(ok, false);
  assert.ok(lines.some(line =>
    line.includes('FAIL Postgres, Discord and Lavalink ready') &&
    line.includes('received 503')));
});

test('malformed 200 readiness payload never counts as healthy', async () => {
  let index = 0;
  const ok = await runSmoke(
    'https://api.staging.example.test/api/v1',
    async () => {
      const probe = probes[index++];
      return {
        status: probe.status,
        json: async () => {
          if (probe.checkReadiness) throw new Error('invalid JSON');
          return ready;
        },
      };
    },
    () => {},
  );
  assert.equal(ok, false);
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
  for (const url of [
    'https://api.staging.example.test/api/v1?token=should-not-be-sent',
    'https://api.staging.example.test/api/v1#oauth-fragment',
    'https://api.staging.example.test/other/api/v1',
  ]) {
    let requests = 0;
    await assert.rejects(
      () => runSmoke(url, async () => { requests++; return { status: 200 }; }),
      /must be an HTTP\(S\) URL/,
    );
    assert.equal(requests, 0);
  }
});

test('exercises the real HTTP transport against an isolated local server', async (t) => {
  const { createServer } = await import('node:http');
  const server = createServer((req, res) => {
    const route = req.url || '';
    let status = 401;
    let body = {};
    if (route === '/api/v1/status') status = 200;
    if (route === '/api/v1/ready') { status = 200; body = ready; }
    if (route === '/api/v1/auth/refresh' && !req.headers['x-yuugen-client']) {
      status = 403;
    }
    if (route === '/api/v1/auth/exchange' && req.headers.origin) {
      status = 403;
    }
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(body));
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
