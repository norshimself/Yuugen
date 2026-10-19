import { ExecutionContext } from '@nestjs/common';
import { Repository } from 'typeorm';
import { SessionGuard } from './session.guard';
import { Session } from './session.entity';

describe('SessionGuard cookie-only refresh', () => {
  const sessionId = '7a83570f-c866-4c46-a3db-38c03ee7bd2a';
  const userId = '123456789012345678';

  const setup = (expiresAt = new Date(Date.now() + 60_000)) => {
    const repo = {
      findOne: jest.fn().mockResolvedValue({
        id: sessionId,
        userId,
        expiresAt,
      }),
      delete: jest.fn(),
    } as unknown as Repository<Session>;
    const request: any = {
      cookies: { yuugen_session: sessionId },
      headers: {},
      body: {},
    };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { guard: new SessionGuard(repo), request, context, repo };
  };

  it('accepts an unexpired refresh session stored in an HttpOnly cookie', async () => {
    const { guard, context, request } = setup();
    await expect(guard.canActivate(context)).resolves.toBe(true);
    expect(request.user).toEqual({ id: userId });
  });

  it('ignores refresh tokens passed through headers or request bodies', async () => {
    const { guard, context, request } = setup();
    request.cookies = {};
    request.headers['x-refresh-token'] = sessionId;
    request.body.refresh_token = sessionId;
    await expect(guard.canActivate(context)).rejects.toThrow('Sign in required');
  });

  it('deletes expired sessions and rejects refresh', async () => {
    const { guard, context, repo } = setup(new Date(Date.now() - 10_000));
    await expect(guard.canActivate(context)).rejects.toThrow('Session expired');
    expect(repo.delete).toHaveBeenCalledWith({ id: sessionId });
  });

  it('rejects login grants even if provided as the cookie', async () => {
    const { guard, context, request, repo } = setup();
    request.cookies.yuugen_session = 'oauth-code:' + 'c'.repeat(64);
    await expect(guard.canActivate(context)).rejects.toThrow('Sign in required');
    expect(repo.findOne).not.toHaveBeenCalled();
  });
});
