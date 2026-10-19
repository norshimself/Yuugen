import { JwtService } from '@nestjs/jwt';
import { Repository } from 'typeorm';
import { AuthController } from './auth.controller';
import { Session } from './session.entity';

describe('AuthController one-time OAuth grants', () => {
  const userId = '123456789012345678';

  const makeController = () => {
    const query = {
      delete: jest.fn().mockReturnThis(),
      from: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [{ userId }] }),
    };
    const repo = {
      create: jest.fn((data) => data),
      save: jest.fn(async (data) => data),
      delete: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(query),
    } as unknown as Repository<Session>;
    const jwt = {
      sign: jest.fn(({ userId: id }) => `jwt-for-${id}`),
    } as unknown as JwtService;
    const response = {
      redirect: jest.fn().mockReturnValue(undefined),
      cookie: jest.fn(),
      clearCookie: jest.fn(),
      setHeader: jest.fn(),
    };
    return {
      controller: new AuthController(repo, jwt),
      repo,
      query,
      response,
    };
  };

  it('redirects with a short-lived code in a fragment, not an access or refresh token', async () => {
    const { controller, repo, response } = makeController();
    await controller.callback({ user: { id: userId } }, response);
    const url = new URL(response.redirect.mock.calls[0][0]);
    const code = new URLSearchParams(url.hash.slice(1)).get('code');

    expect(code).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(url.search).toBe('');
    expect(url.toString()).not.toContain('access_token');
    expect(url.toString()).not.toContain('refresh_token');
    expect(repo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        id: expect.stringMatching(/^oauth-code:[0-9a-f]{64}$/),
        userId,
      }),
    );
    expect(JSON.stringify((repo.create as jest.Mock).mock.calls)).not.toContain(code);
  });

  it('atomically consumes a code and issues an HttpOnly refresh cookie', async () => {
    const { controller, query, response } = makeController();
    const code = 'a'.repeat(43);
    const result = await controller.exchange(code, response);

    expect(query.where).toHaveBeenCalledWith(
      expect.stringContaining('"expiresAt" > :now'),
      expect.objectContaining({ id: expect.stringMatching(/^oauth-code:/) }),
    );
    expect(query.returning).toHaveBeenCalledWith('*');
    expect(response.cookie).toHaveBeenCalledWith(
      'yuugen_session',
      expect.any(String),
      expect.objectContaining({
        httpOnly: true,
        sameSite: 'lax',
        path: '/api/v1/auth',
      }),
    );
    expect(result).toEqual({ success: true, access_token: `jwt-for-${userId}` });
    expect(JSON.stringify(result)).not.toContain('refresh_token');
  });

  it('rejects replayed and expired login codes', async () => {
    const { controller, query, response } = makeController();
    query.execute.mockResolvedValueOnce({ raw: [] });
    await expect(controller.exchange('b'.repeat(43), response))
      .rejects.toThrow('Invalid or expired sign-in code');
    expect(response.cookie).not.toHaveBeenCalled();
  });

  it('returns an access token but never exposes the refresh session', async () => {
    const { controller } = makeController();
    const result = await controller.refresh({ user: { id: userId } });
    expect(result).toEqual({ success: true, access_token: `jwt-for-${userId}` });
  });

  it('revokes the cookie session on logout', async () => {
    const { controller, repo, response } = makeController();
    const id = '7a83570f-c866-4c46-a3db-38c03ee7bd2a';
    const result = await controller.logout(
      { cookies: { yuugen_session: id } },
      response,
    );
    expect(result).toEqual({ success: true });
    expect(repo.delete).toHaveBeenCalledWith({ id });
    expect(response.clearCookie).toHaveBeenCalledWith(
      'yuugen_session',
      expect.objectContaining({ path: '/api/v1/auth' }),
    );
  });
});
