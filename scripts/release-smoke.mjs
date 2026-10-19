/**
 * Read-only/unauthenticated API readiness probes.
 * This never logs in, writes guild settings, joins voice, or touches balances.
 * Usage: YUUGEN_API_URL=http://localhost:3001/api/v1 node scripts/release-smoke.mjs
 */
import { pathToFileURL } from 'node:url';

const json = { 'Content-Type': 'application/json' };
const firstParty = { ...json, 'x-yuugen-client': 'web' };

export const probes = [
  { label: 'API status', path: '/status', status: 200 },
  { label: 'Postgres, Discord and Lavalink ready', path: '/ready', status: 200, checkReadiness: true },
  { label: 'Guild listing requires a JWT', path: '/player/guilds', status: 401 },
  { label: 'Guild settings require a JWT', path: '/settings?guildId=123456789012345678', status: 401 },
  { label: 'Economy profile requires a JWT', path: '/economy/profile', status: 401 },
  { label: 'Trivia requires a JWT', path: '/games/trivia/question', status: 401 },
  {
    label: 'Refresh requires first-party header', path: '/auth/refresh', status: 403,
    init: { method: 'POST', headers: json },
  },
  {
    label: 'Refresh rejects missing session cookie', path: '/auth/refresh', status: 401,
    init: { method: 'POST', headers: firstParty },
  },
  {
    label: 'OAuth exchange rejects malformed grants', path: '/auth/exchange', status: 401,
    init: { method: 'POST', headers: firstParty, body: JSON.stringify({ code: 'invalid' }) },
  },
  {
    label: 'OAuth exchange rejects foreign origins', path: '/auth/exchange', status: 403,
    init: {
      method: 'POST',
      headers: { ...firstParty, Origin: 'https://untrusted.example.invalid' },
      body: JSON.stringify({ code: 'invalid' }),
    },
  },
];

export async function runSmoke(apiUrl, transport = fetch, print = console.log) {
  const parsed = new URL(apiUrl);
  if (
    !['http:', 'https:'].includes(parsed.protocol) ||
    parsed.username || parsed.password ||
    !parsed.pathname.replace(/\/+$/, '').endsWith('/api/v1')
  ) {
    throw new Error('YUUGEN_API_URL must be an HTTP(S) URL ending in /api/v1 with no credentials');
  }
  const base = parsed.href.replace(/\/+$/, '');
  let failed = 0;
  for (const probe of probes) {
    let actual = 'network error';
    try {
      const response = await transport(`${base}${probe.path}`, {
        ...probe.init,
        redirect: 'manual',
        signal: AbortSignal.timeout(7000),
      });
      actual = response.status;
      if (probe.checkReadiness && response.status === probe.status) {
        try {
          const body = await response.json();
          const names = ['database', 'discord', 'lavalink'];
          if (body?.status !== 'ready' ||
              !names.every((name) => body?.dependencies?.[name] === 'up')) {
            actual = `${response.status} (dependencies not ready)`;
          }
        } catch {
          actual = `${response.status} (invalid readiness response)`;
        }
      }
    } catch (error) {
      actual = error instanceof Error ? error.message : 'network error';
    }
    const ok = actual === probe.status;
    if (!ok) failed += 1;
    print(`${ok ? 'PASS' : 'FAIL'} ${probe.label}: expected ${probe.status}, received ${actual}`);
  }
  print(`${probes.length - failed}/${probes.length} API probes passed`);
  return failed === 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const endpoint = process.env.YUUGEN_API_URL || 'http://localhost:3001/api/v1';
  runSmoke(endpoint).then((success) => {
    if (!success) process.exitCode = 1;
  }).catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  });
}
