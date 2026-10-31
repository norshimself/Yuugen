import { ExecutionContext, Logger, CallHandler } from '@nestjs/common';
import { lastValueFrom, of } from 'rxjs';
import { LoggingInterceptor } from './logging.interceptor';

describe('LoggingInterceptor privacy safe HTTP metadata (#92)', () => {
  afterEach(() => jest.restoreAllMocks());

  function invoke(request: Record<string,unknown>, code = 200) {
    const spy = jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
    const ctx = {
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({statusCode:code}),
      }),
    } as unknown as ExecutionContext;
    const next = {handle: () => of('handled')} as CallHandler;
    return {spy, run: () => lastValueFrom(new LoggingInterceptor().intercept(ctx,next))};
  }

  it('never logs OAuth authorization code/state query values or cookies',async()=>{
    const t = invoke({
      method:'GET',
      url:'/api/v1/auth/callback?code=secret-grant&state=secret-state',
      originalUrl:'/api/v1/auth/callback?code=secret-grant',
      headers:{authorization:'Bearer secret-auth'},
      route:{path:'/api/v1/auth/callback'},
    },302);
    await t.run();
    expect(t.spy).toHaveBeenCalledWith(
      expect.stringContaining('GET /api/v1/auth/callback 302'),
    );
    const log=JSON.stringify(t.spy.mock.calls);
    for(const secret of ['secret-grant','secret-state','secret-auth','?code=']) {
      expect(log).not.toContain(secret);
    }
  });

  it('redacts literal Discord snowflakes even if a route template contains one',async()=>{
    const t=invoke({
      method:'GET',
      route:{path:'/api/v1/guilds/123456789012345678'},
      url:'/api/v1/guilds/123456789012345678?token=secret',
    });
    await t.run();
    const log=JSON.stringify(t.spy.mock.calls);
    expect(log).toContain('/api/v1/guilds/:id');
    expect(log).not.toContain('123456789012345678');
    expect(log).not.toContain('secret');
  });

  it('uses fixed placeholder when the router template is absent or unsafe',async()=>{
    const t=invoke({
      method:'GET',
      route:{path:'/callback?access_token=secret'},
      url:'/callback?access_token=secret',
    });
    await t.run();
    expect(JSON.stringify(t.spy.mock.calls)).toContain('<unmatched>');
    expect(JSON.stringify(t.spy.mock.calls)).not.toContain('secret');
  });

  it('does not log Discord interactions or socket traffic as HTTP',async()=>{
    const t=invoke({route:{path:'/sensitive'}});
    await t.run();
    expect(t.spy).not.toHaveBeenCalled();
  });
});
