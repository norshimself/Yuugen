import { ExecutionContext } from '@nestjs/common';
import { FirstPartyRequestGuard } from './first-party-request.guard';

describe('FirstPartyRequestGuard', () => {
  const guard = new FirstPartyRequestGuard();
  const savedFrontend = process.env.FRONTEND_URL;
  const savedCors = process.env.CORS_ORIGIN;

  beforeEach(() => {
    process.env.FRONTEND_URL = 'http://localhost:3000';
    delete process.env.CORS_ORIGIN;
  });
  afterAll(() => {
    if (savedFrontend === undefined) delete process.env.FRONTEND_URL;
    else process.env.FRONTEND_URL = savedFrontend;
    if (savedCors === undefined) delete process.env.CORS_ORIGIN;
    else process.env.CORS_ORIGIN = savedCors;
  });

  const makeRequest = (headers: Record<string, string>) => {
    const request = { headers };
    const context = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return context;
  };

  it('accepts an allowed browser JSON POST', () => {
    expect(guard.canActivate(makeRequest({
      'x-yuugen-client': 'web',
      'content-type': 'application/json',
      origin: 'http://localhost:3000',
    }))).toBe(true);
  });

  it('rejects a cross-site form without the custom header', () => {
    expect(() => guard.canActivate(makeRequest({
      'content-type': 'application/x-www-form-urlencoded',
      origin: 'https://malicious.invalid',
    }))).toThrow('Untrusted session request');
  });

  it('rejects cross-origin requests despite the custom header', () => {
    expect(() => guard.canActivate(makeRequest({
      'x-yuugen-client': 'web',
      'content-type': 'application/json',
      origin: 'https://malicious.invalid',
    }))).toThrow('Untrusted request origin');
  });

  it('rejects non-JSON content types', () => {
    expect(() => guard.canActivate(makeRequest({
      'x-yuugen-client': 'web',
      'content-type': 'text/plain',
      origin: 'http://localhost:3000',
    }))).toThrow('JSON requests required');
  });
});
