import { hasUrlScheme, isPublicHttpUrl } from './public-http-url';

describe('media URL safety', () => {
  it.each([
    'file:///etc/passwd',
    'ftp://example.com/live',
    'http://localhost:3000/internal',
    'http://127.0.0.1:8080/admin',
    'http://10.0.0.1/live',
    'http://192.168.1.1/live',
    'http://169.254.169.254/latest/meta-data',
    'http://[::1]/live',
    'https://user:password@8.8.8.8/live',
  ])('rejects non-public URLs (%s)', async (url) => {
    expect(await isPublicHttpUrl(url)).toBe(false);
  });

  it.each([
    'https://1.1.1.1/stream',
    'http://8.8.8.8:8000/radio',
  ])('allows a public HTTP address (%s)', async (url) => {
    expect(await isPublicHttpUrl(url)).toBe(true);
  });

  it('only detects explicit URL schemes', () => {
    expect(hasUrlScheme('https://example.org/song')).toBe(true);
    expect(hasUrlScheme('ytsearch:ambient music')).toBe(false);
    expect(hasUrlScheme('ambient music')).toBe(false);
  });
});
