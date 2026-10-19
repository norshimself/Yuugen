import { ExecutionContext } from '@nestjs/common';
import { DiscordAuthGuard } from './discord-auth.guard';

describe('DiscordAuthGuard state protection', () => {
  const makeContext = (path: string, cookies: Record<string, string> = {}, query: Record<string, string> = {}) => {
    const req = { path, cookies, query };
    const res = { cookie: jest.fn(), clearCookie: jest.fn() };
    const ctx = {
      switchToHttp: () => ({ getRequest: () => req, getResponse: () => res }),
    } as unknown as ExecutionContext;
    return { ctx, req, res };
  };

  it('adds a random state cookie and redirect parameter at login', () => {
    const guard = new DiscordAuthGuard();
    const { ctx, res } = makeContext('/api/v1/auth/login');
    const options = guard.getAuthenticateOptions(ctx);
    expect(options.state).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(res.cookie).toHaveBeenCalledWith(
      'yuugen_oauth_state',
      options.state,
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/v1/auth',
      }),
    );
  });

  it('rejects an invalid callback before invoking Passport', async () => {
    const guard = new DiscordAuthGuard();
    const { ctx, res } = makeContext(
      '/api/v1/auth/callback',
      { yuugen_oauth_state: 'a'.repeat(43) },
      { state: 'b'.repeat(43) },
    );
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid Discord OAuth state');
    expect(res.clearCookie).toHaveBeenCalledWith(
      'yuugen_oauth_state',
      expect.objectContaining({ path: '/api/v1/auth' }),
    );
  });

  it('rejects a callback with no state cookie', async () => {
    const guard = new DiscordAuthGuard();
    const { ctx } = makeContext('/api/v1/auth/callback', {}, { state: 'a'.repeat(43) });
    await expect(guard.canActivate(ctx)).rejects.toThrow('Invalid Discord OAuth state');
  });
});
