import assert from 'node:assert/strict';
import { test } from 'node:test';
import { configure, createApi, runAcceptance, subscribeSocket } from './staging-acceptance.mjs';

const GUILD = '123456789012345678';
const CHANNEL = '234567890123456789';
const TOKEN = 'test-jwt-do-not-use';
const env = {
  YUUGEN_STAGING_API_URL: 'https://api.staging.example.test/api/v1',
  YUUGEN_TEST_ACCESS_TOKEN: TOKEN,
  YUUGEN_TEST_GUILD_ID: GUILD,
};

function disposableEnv(options = {}) {
  return {
    ...env,
    YUUGEN_STAGING_HOST: 'api.staging.example.test',
    YUUGEN_TEST_ALLOW_WRITES: 'staging-only',
    YUUGEN_TEST_DISPOSABLE_GUILD: 'yes',
    ...options,
  };
}

function fakeSocketFactory(address) {
  return class MockSocket {
    constructor(url) {
      assert.equal(url, address);
      this.listeners = new Map();
      queueMicrotask(() => this.emit('open', {}));
    }
    addEventListener(name, listener) {
      this.listeners.set(name, listener);
    }
    emit(name, value) { this.listeners.get(name)?.(value); }
    send(payload) {
      const { data } = JSON.parse(payload);
      queueMicrotask(() => this.emit('message', {
        data: JSON.stringify(data.token === 'invalid-jwt'
          ? { event: 'subscriptionError', code: 'invalid_token' }
          : { event: 'subscribed', guildId: data.guildId }),
      }));
    }
    close() { this.closed = true; }
  };
}

function fakeBackend(config, { unhealthy = false, failVoicePlay = false, badAuthorization = false } = {}) {
  const calls = [];
  let connected = false;
  let playing = false;
  let rpsPlayed = false;
  let triviaStarted = false;
  let triviaAnswered = false;
  function respond(status, data) { return { status, json: async () => data }; }
  async function transport(url, options) {
    const request = new URL(url);
    const path = request.pathname.replace('/api/v1', '') + request.search;
    const body = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, method: options.method, body, authorization: options.headers.Authorization || '' });
    if (path === '/ready') return respond(200, {
      status: 'ready', dependencies: { database: 'up', discord: 'up', lavalink: unhealthy ? 'down' : 'up' },
    });
    if (!options.headers.Authorization || badAuthorization) return respond(401, { message: 'Unauthenticated' });
    if (path === '/player/guilds') return respond(200, [{ id: GUILD, name: 'Disposable QA guild' }]);
    if (path === `/player/channels?guildId=${GUILD}`) return respond(200, {
      success: true, channels: [{ id: CHANNEL, name: 'qa-voice' }],
    });
    if (path === `/player/queue?guildId=${GUILD}`) return respond(200, { success: connected, tracks: [] });
    if (path === `/player/nowplaying?guildId=${GUILD}`) return respond(200, {
      success: connected, connected, playing, ...(playing ? { track: { title: 'QA track' } } : {}),
    });
    if (path === '/player/join') { connected = true; return respond(201, { success: true }); }
    if (path === '/player/play') { playing = !failVoicePlay; return respond(201, { success: !failVoicePlay }); }
    if (path === '/player/pause' || path === '/player/resume') return respond(201, { success: true });
    if (path === '/player/stop') { playing = false; connected = false; return respond(201, { success: true }); }
    if (path === '/games/rps') {
      const success = !rpsPlayed; rpsPlayed = true;
      return respond(201, { success, reward: success ? 20 : 0 });
    }
    if (path === '/games/trivia/question') {
      triviaStarted = true;
      return respond(201, { success: true, question: 'QA?', options: ['a','b','c','d'] });
    }
    if (path === '/games/trivia/answer') {
      if (!triviaStarted) return respond(400, { message: 'No game' });
      const success = !triviaAnswered; triviaAnswered = true;
      return respond(201, { success });
    }
    return respond(404, { message: 'Unknown test endpoint' });
  }
  return { calls, transport };
}

function harness(config, backend) {
  const logs = [];
  const Ws = fakeSocketFactory(config.wsUrl);
  return {
    run: () => runAcceptance(config, {
      transport: backend.transport,
      makeSocket: (url) => new Ws(url),
      log: (s) => logs.push(s),
      sleep: async () => {},
    }),
    logs,
  };
}

test('read-only configuration is strict about URLs and JWT/guild inputs', () => {
  const config = configure(env);
  assert.equal(config.allowVoice, false);
  assert.equal(config.allowEconomy, false);
  assert.equal(config.wsUrl, 'wss://api.staging.example.test/api/v1/player/ws');
  assert.throws(() => configure({ ...env, YUUGEN_STAGING_API_URL: 'http://api.staging.example.test/api/v1' }), /HTTPS/);
  assert.throws(() => configure({ ...env, YUUGEN_STAGING_API_URL: 'https://user:password@api.staging.example.test/api/v1' }), /clean HTTP/);
  assert.throws(() => configure({ ...env, YUUGEN_TEST_GUILD_ID: 'wrong' }), /valid YUUGEN_TEST_GUILD_ID/);
});

test('state-changing tests require explicit staging, host match, and disposable resources', () => {
  const base = { ...env, YUUGEN_TEST_ECONOMY: 'yes' };
  assert.throws(() => configure(base), /Writes require/);
  assert.throws(() => configure({ ...disposableEnv({ YUUGEN_TEST_ECONOMY: 'yes' }), YUUGEN_STAGING_HOST: 'wrong.example.com' }), /Writes require/);
  assert.throws(() => configure(disposableEnv({ YUUGEN_TEST_ECONOMY: 'yes' })), /disposable staging Discord account/);
  assert.throws(() => configure(disposableEnv({ YUUGEN_TEST_VOICE: 'yes' })), /voice channel ID and track query/);
  assert.throws(() => configure({
    ...disposableEnv({ YUUGEN_TEST_ECONOMY: 'yes', YUUGEN_TEST_DISPOSABLE_ACCOUNT: 'yes' }),
    YUUGEN_STAGING_API_URL: 'https://api.production.example.com/api/v1',
    YUUGEN_STAGING_HOST: 'api.production.example.com',
  }), /Writes require/);
});

test('read-only acceptance exercises access, readiness, and WebSocket without any API writes', async () => {
  const config = configure(env);
  const backend = fakeBackend(config);
  const h = harness(config, backend);
  const result = await h.run();
  assert.equal(result.passed, true);
  assert.equal(result.results.length, 7);
  assert.equal(backend.calls.length, 6); // ready, anonymous guilds, mutual guilds, channels, nowplaying, queue
  assert.ok(backend.calls.every((c) => c.method === 'GET'));
  assert.ok(!h.logs.join('\n').includes(TOKEN));
});

test('healthy HTTP response with broken Lavalink fails acceptance', async () => {
  const config = configure(env);
  const backend = fakeBackend(config, { unhealthy: true });
  const result = await harness(config, backend).run();
  assert.equal(result.passed, false);
  assert.ok(result.results.some((r) => r.name.includes('dependency readiness') && !r.pass));
});

test('missing guild authorization fails acceptance rather than reporting success', async () => {
  const config = configure(env);
  const backend = fakeBackend(config, { badAuthorization: true });
  const result = await harness(config, backend).run();
  assert.equal(result.passed, false);
  assert.ok(result.results.some((r) => r.name.includes('mutual-guild') && !r.pass));
});

test('voice acceptance checks join, play, pause, resume, cleanup; writes only when opted in', async () => {
  const config = configure(disposableEnv({
    YUUGEN_TEST_VOICE: 'yes',
    YUUGEN_TEST_VOICE_CHANNEL_ID: CHANNEL,
    YUUGEN_TEST_TRACK_QUERY: 'ytsearch:short QA track',
  }));
  const backend = fakeBackend(config);
  const result = await harness(config, backend).run();
  assert.equal(result.passed, true);
  const calls = backend.calls.filter((c) => c.method === 'POST').map((c) => c.path);
  assert.deepEqual(calls, ['/player/join','/player/play','/player/pause','/player/resume','/player/stop']);
});

test('voice test stops player if playback fails', async () => {
  const config = configure(disposableEnv({
    YUUGEN_TEST_VOICE: 'yes',
    YUUGEN_TEST_VOICE_CHANNEL_ID: CHANNEL,
    YUUGEN_TEST_TRACK_QUERY: 'ytsearch:short QA track',
  }));
  const backend = fakeBackend(config, { failVoicePlay: true });
  const result = await harness(config, backend).run();
  assert.equal(result.passed, false);
  assert.ok(backend.calls.some((c) => c.path === '/player/stop'));
});

test('economy acceptance detects repeated RPS and trivia payouts on disposable account', async () => {
  const config = configure(disposableEnv({
    YUUGEN_TEST_ECONOMY: 'yes',
    YUUGEN_TEST_DISPOSABLE_ACCOUNT: 'yes',
  }));
  const backend = fakeBackend(config);
  const result = await harness(config, backend).run();
  assert.equal(result.passed, true);
  assert.equal(backend.calls.filter((x) => x.path === '/games/rps').length, 2);
  assert.equal(backend.calls.filter((x) => x.path === '/games/trivia/answer').length, 2);
});

test('subscribeSocket rejects a forbidden valid token response rather than counting it as subscribed', async () => {
  const config = configure(env);
  const Mock = fakeSocketFactory(config.wsUrl);
  const response = await subscribeSocket(config.wsUrl, config.guildId, 'invalid-jwt', 'subscriptionError', (url) => new Mock(url));
  assert.equal(response.code, 'invalid_token');
});
