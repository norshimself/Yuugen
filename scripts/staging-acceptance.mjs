/**
 * Explicit, operator-run staging acceptance checks for Yuugen.
 * This script never initiates OAuth or reads refresh cookies. Supply a short-
 * lived JWT from a disposable staging login through the local environment.
 * Read-only checks are the default. Writes must be enabled explicitly AND
 * restricted to a development/staging hostname.
 * Node.js >=22; no npm dependencies.
 */
import { pathToFileURL } from 'node:url';

const SNOWFLAKE = /^\d{17,20}$/;
const SAFE_HOST = /(^localhost$|^127\.0\.0\.1$|(^|[.-])(staging|stage|test|dev|local)([.-]|$))/i;
const MAX_ERROR_TEXT = 140;

export function configure(env = process.env) {
  const raw = env.YUUGEN_STAGING_API_URL;
  const token = env.YUUGEN_TEST_ACCESS_TOKEN;
  const guildId = env.YUUGEN_TEST_GUILD_ID;
  if (!raw) throw new Error('Set YUUGEN_STAGING_API_URL (must end with /api/v1)');
  const url = new URL(raw);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
      url.search || url.hash || !/^\/api\/v1\/?$/.test(url.pathname)) {
    throw new Error('Use a clean HTTP(S) API base URL ending at /api/v1');
  }
  if (url.protocol !== 'https:' && !['localhost', '127.0.0.1'].includes(url.hostname)) {
    throw new Error('A remote staging backend must use HTTPS');
  }
  if (!token || !guildId || !SNOWFLAKE.test(guildId)) {
    throw new Error('Provide YUUGEN_TEST_ACCESS_TOKEN and a valid YUUGEN_TEST_GUILD_ID');
  }

  const allowVoice = env.YUUGEN_TEST_VOICE === 'yes';
  const allowEconomy = env.YUUGEN_TEST_ECONOMY === 'yes';
  if (allowVoice || allowEconomy) {
    // An opt-in env variable is not enough: enforce an explicit staging host
    // and disposable resources before issuing any write request.
    if (env.YUUGEN_TEST_ALLOW_WRITES !== 'staging-only' ||
        env.YUUGEN_STAGING_HOST !== url.hostname ||
        !SAFE_HOST.test(url.hostname) ||
        env.YUUGEN_TEST_DISPOSABLE_GUILD !== 'yes') {
      throw new Error('Writes require staging-only, matching staging host and disposable test guild');
    }
  }
  const voiceChannelId = env.YUUGEN_TEST_VOICE_CHANNEL_ID;
  if (allowVoice && (!voiceChannelId || !SNOWFLAKE.test(voiceChannelId) ||
      !env.YUUGEN_TEST_TRACK_QUERY?.trim())) {
    throw new Error('Voice tests require a staging voice channel ID and track query');
  }
  if (allowEconomy && env.YUUGEN_TEST_DISPOSABLE_ACCOUNT !== 'yes') {
    throw new Error('Economy tests require a disposable staging Discord account');
  }

  return {
    url: url.href.replace(/\/+$/, ''),
    wsUrl: url.href.replace(/\/+$/, '').replace(/^http/, 'ws') + '/player/ws',
    token, guildId,
    outsiderToken: env.YUUGEN_TEST_OUTSIDER_ACCESS_TOKEN || '',
    nonAdminToken: env.YUUGEN_TEST_NONADMIN_ACCESS_TOKEN || '',
    voiceChannelId, trackQuery: env.YUUGEN_TEST_TRACK_QUERY,
    allowVoice, allowEconomy,
  };
}

function shortError(value) {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  // Never show user-entered access tokens in failures.
  return (text || 'unspecified error').slice(0, MAX_ERROR_TEXT);
}

export function createApi(config, transport = fetch) {
  return async function request(method, path, body, token = config.token) {
    if (!/^\/[a-zA-Z0-9/?&=_%-]+$/.test(path) || path.startsWith('//') || path.includes('..')) {
      throw new Error('API path must be a relative endpoint');
    }
    const response = await transport(config.url + path, {
      method,
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      redirect: 'manual',
      signal: AbortSignal.timeout(10_000),
    });
    const data = await response.json().catch(() => ({}));
    return { status: response.status, data };
  };
}

export async function subscribeSocket(url, guildId, token, expectedEvent, makeSocket = (u) => new WebSocket(u)) {
  const socket = makeSocket(url);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => finish(new Error('WebSocket subscription timed out')), 10_000);
    function finish(result) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      if (result instanceof Error) reject(result);
      else resolve(result);
    }
    socket.addEventListener('open', () => {
      socket.send(JSON.stringify({ event: 'subscribeGuild', data: { guildId, token } }));
    });
    socket.addEventListener('message', (event) => {
      let body;
      try { body = JSON.parse(String(event.data)); }
      catch { finish(new Error('WebSocket returned invalid JSON')); return; }
      if (body.event === expectedEvent) {
        if (expectedEvent === 'subscribed' && body.guildId !== guildId) {
          finish(new Error('WebSocket subscribed to the wrong guild'));
        } else if (expectedEvent === 'subscriptionError' && body.code !== 'invalid_token') {
          finish(new Error('Invalid token did not produce invalid_token response'));
        } else finish(body);
      } else if (body.event === 'subscriptionError') {
        finish(new Error(`WebSocket authorization rejected: ${shortError(body.code)}`));
      }
    });
    socket.addEventListener('error', () => finish(new Error('WebSocket connection failed')));
    socket.addEventListener('close', () => finish(new Error('WebSocket closed before subscription response')));
  });
}

export async function runAcceptance(config, {
  transport = fetch,
  makeSocket = (url) => new WebSocket(url),
  log = console.log,
  sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
} = {}) {
  const api = createApi(config, transport);
  const results = [];
  async function check(name, action) {
    try {
      const message = await action();
      results.push({ name, pass: true, message: message || 'passed' });
      log(`PASS ${name}`);
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : shortError(error);
      results.push({ name, pass: false, message });
      log(`FAIL ${name}: ${shortError(message)}`);
      return false;
    }
  }
  function expect(condition, message) {
    if (!condition) throw new Error(message);
  }
  function status(result, expected, route) {
    expect(result.status === expected, `${route}: expected ${expected}, received ${result.status}`);
  }

  await check('backend dependency readiness', async () => {
    const r = await api('GET', '/ready', undefined, '');
    status(r, 200, '/ready');
    expect(r.data?.status === 'ready' &&
      ['database', 'discord', 'lavalink'].every((name) => r.data?.dependencies?.[name] === 'up'),
    'database, Discord and Lavalink must all report up');
  });
  await check('missing bearer token rejected', async () => {
    const r = await api('GET', '/player/guilds', undefined, '');
    status(r, 401, '/player/guilds');
  });
  const guildsOK = await check('authenticated mutual-guild listing', async () => {
    const r = await api('GET', '/player/guilds');
    status(r, 200, '/player/guilds');
    expect(Array.isArray(r.data), 'guild list is not an array');
    expect(r.data.some((guild) => guild.id === config.guildId), 'test guild is not in mutual guilds');
  });
  if (guildsOK) {
    await check('guild-scoped voice channel listing', async () => {
      const r = await api('GET', `/player/channels?guildId=${config.guildId}`);
      status(r, 200, '/player/channels');
      expect(r.data?.success === true && Array.isArray(r.data.channels), 'missing accessible channels');
      if (config.allowVoice) {
        expect(r.data.channels.some((channel) => channel.id === config.voiceChannelId),
          'voice channel is not accessible to the test account');
      }
    });
    await check('guild-scoped player status and queue', async () => {
      const [now, queue] = await Promise.all([
        api('GET', `/player/nowplaying?guildId=${config.guildId}`),
        api('GET', `/player/queue?guildId=${config.guildId}`),
      ]);
      status(now, 200, '/player/nowplaying');
      status(queue, 200, '/player/queue');
      expect(typeof now.data?.success === 'boolean', 'player status missing success flag');
      expect(typeof queue.data?.success === 'boolean', 'queue status missing success flag');
    });
    await check('WebSocket guild subscription with valid JWT', async () => {
      await subscribeSocket(config.wsUrl, config.guildId, config.token, 'subscribed', makeSocket);
    });
    await check('WebSocket rejects invalid JWT', async () => {
      await subscribeSocket(config.wsUrl, config.guildId, 'invalid-jwt', 'subscriptionError', makeSocket);
    });
    if (config.outsiderToken) {
      await check('outsider cannot read player state', async () => {
        const r = await api('GET', `/player/nowplaying?guildId=${config.guildId}`, undefined, config.outsiderToken);
        status(r, 403, '/player/nowplaying outsider');
      });
    }
    if (config.nonAdminToken) {
      await check('non-admin cannot read guild settings', async () => {
        const r = await api('GET', `/settings?guildId=${config.guildId}`, undefined, config.nonAdminToken);
        status(r, 403, '/settings non-admin');
      });
    }
  }

  if (config.allowVoice && guildsOK) {
    await check('live staging Lavalink join/play/pause/resume/stop', async () => {
      const current = await api('GET', `/player/nowplaying?guildId=${config.guildId}`);
      // Prevent the test from disconnecting another user's active session.
      if (current.data?.connected || current.data?.playing) {
        throw new Error('Refusing to touch an already active player: use an empty test guild');
      }
      let joined = false;
      try {
        const join = await api('POST', '/player/join', {
          guildId: config.guildId, channelId: config.voiceChannelId,
        });
        status(join, 201, '/player/join');
        expect(join.data?.success === true, 'voice join rejected');
        joined = true;

        const play = await api('POST', '/player/play', {
          guildId: config.guildId, channelId: config.voiceChannelId,
          query: config.trackQuery,
        });
        status(play, 201, '/player/play');
        expect(play.data?.success === true, `play rejected: ${shortError(play.data?.message)}`);

        let started = false;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const now = await api('GET', `/player/nowplaying?guildId=${config.guildId}`);
          if (now.data?.success && now.data?.track) { started = true; break; }
          await sleep(1000);
        }
        expect(started, 'Lavalink never reported a loaded track');
        const pause = await api('POST', '/player/pause', { guildId: config.guildId });
        status(pause, 201, '/player/pause');
        expect(pause.data?.success === true, 'pause failed');
        const resume = await api('POST', '/player/resume', { guildId: config.guildId });
        status(resume, 201, '/player/resume');
        expect(resume.data?.success === true, 'resume failed');
      } finally {
        if (joined) {
          const stop = await api('POST', '/player/stop', { guildId: config.guildId });
          expect(stop.status === 201 && stop.data?.success === true,
            'cleanup failed: staging player may still be connected');
        }
      }
    });
  }

  if (config.allowEconomy && guildsOK) {
    await check('staging RPS cooldown across duplicate API calls', async () => {
      const a = await api('POST', '/games/rps', { choice: 'paper' });
      status(a, 201, '/games/rps');
      expect(a.data?.success === true, 'first RPS attempt did not start: use a fresh disposable account');
      const b = await api('POST', '/games/rps', { choice: 'paper' });
      status(b, 201, '/games/rps');
      expect(b.data?.success === false && b.data?.reward === 0, 'second RPS call bypassed cooldown');
    });
    await check('staging trivia payout cannot be repeated', async () => {
      // Starting trivia creates a session; never run in read-only mode.
      const question = await api('POST', '/games/trivia/question');
      status(question, 201, '/games/trivia/question');
      expect(question.data?.success === true && Array.isArray(question.data?.options),
        'fresh trivia question unavailable: use a disposable account');
      const first = await api('POST', '/games/trivia/answer', { answerIndex: 0 });
      status(first, 201, '/games/trivia/answer');
      expect(first.data?.success === true, 'initial trivia answer not processed');
      const second = await api('POST', '/games/trivia/answer', { answerIndex: 0 });
      status(second, 201, '/games/trivia/answer');
      expect(second.data?.success === false, 'duplicate trivia answer succeeded');
    });
  }
  log(`${results.filter((result) => result.pass).length}/${results.length} staging checks passed`);
  return { passed: results.every((result) => result.pass), results };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const config = configure();
    const { passed } = await runAcceptance(config);
    if (!passed) process.exitCode = 1;
  } catch (error) {
    console.error(`Configuration rejected: ${error instanceof Error ? error.message : 'unknown error'}`);
    process.exitCode = 2;
  }
}
