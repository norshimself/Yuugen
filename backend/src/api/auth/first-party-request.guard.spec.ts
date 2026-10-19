import { ExecutionContext } from '@nestjs/common';
import { FirstPartyRequestGuard } from './first-party-request.guard';

describe('FirstPartyRequestGuard', () => {
  const guard = new FirstPartyRequestGuard();

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
