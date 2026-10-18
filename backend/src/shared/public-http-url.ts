import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';

function isPublicIp(address: string): boolean {
  const family = isIP(address);
  if (family === 4) {
    const [a, b, c] = address.split('.').map(Number);
    return !(
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 0 && c === 0) ||
      (a === 192 && b === 0 && c === 2) ||
      (a === 192 && b === 88 && c === 99) ||
      (a === 192 && b === 168) ||
      (a === 198 && (b === 18 || b === 19)) ||
      (a === 198 && b === 51 && c === 100) ||
      (a === 203 && b === 0 && c === 113)
    );
  }
  if (family === 6) {
    const normalized = address.toLowerCase();
    // Permit IPv6 global unicast only (2000::/3), excluding documentation.
    return /^[23][a-f0-9]*:/.test(normalized) &&
      !/^2001:(?:0?db8):/.test(normalized);
  }
  return false;
}

/**
 * Best-effort safety check for untrusted media URLs before either Node.js or
 * Lavalink fetches them. Rejects local/private destinations and non-HTTP
 * schemes. DNS rebinding and redirects also require egress/network controls.
 */
export async function isPublicHttpUrl(rawUrl: string): Promise<boolean> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return false;
  }

  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:') ||
    url.username ||
    url.password
  ) {
    return false;
  }

  const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase();
  if (
    !host.includes('.') ||
    host === 'localhost' ||
    ['.localhost', '.local', '.internal', '.home', '.lan'].some((suffix) =>
      host.endsWith(suffix),
    )
  ) {
    // Public IPv6 literals are handled below, even without dots.
    if (isIP(host) !== 6) return false;
  }

  if (isIP(host)) return isPublicIp(host);
  if (!/^[a-z0-9.-]+$/.test(host)) return false;

  try {
    const addresses = await lookup(host, { all: true });
    return addresses.length > 0 &&
      addresses.every((entry) => isPublicIp(entry.address));
  } catch {
    return false;
  }
}

export function hasUrlScheme(input: string): boolean {
  return /^[a-z][a-z0-9+.-]*:\/\//i.test(input.trim());
}
