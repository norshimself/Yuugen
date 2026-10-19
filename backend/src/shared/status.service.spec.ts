import { ConfigService } from '@nestjs/config';
import { Client } from 'discord.js';
import { DataSource } from 'typeorm';
import { StatusService } from './status.service';

describe('StatusService readiness', () => {
  const originalFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = originalFetch;
    jest.restoreAllMocks();
  });

  function setup() {
    const data = {
      isInitialized: true,
      query: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    } as unknown as DataSource;
    const discord = {
      isReady: jest.fn().mockReturnValue(true),
    } as unknown as Client;
    const values: Record<string, string> = {
      LAVALINK_PASSWORD: 'test-only',
      LAVALINK_HOST: 'lavalink',
      LAVALINK_PORT: '2333',
    };
    const config = {
      get: jest.fn((name: string) => values[name]),
    } as unknown as ConfigService;
    const service = new StatusService(data, discord, config);
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: true });
    return { service, data, discord, config };
  }

  it('requires the database, Discord client and authenticated Lavalink', async () => {
    const { service } = setup();
    await expect(service.checkReadiness()).resolves.toEqual({
      status: 'ready',
      dependencies: { database: 'up', discord: 'up', lavalink: 'up' },
    });
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'http://lavalink:2333/v4/info',
      expect.objectContaining({
        headers: { Authorization: 'test-only' },
      }),
    );
  });

  it('returns unavailable when PostgreSQL is disconnected', async () => {
    const { service, data } = setup();
    Object.defineProperty(data, 'isInitialized', { value: false });
    const report = await service.checkReadiness();
    expect(report.status).toBe('unavailable');
    expect(report.dependencies.database).toBe('down');
  });

  it('returns unavailable if Discord is offline', async () => {
    const { service, discord } = setup();
    jest.spyOn(discord, 'isReady').mockReturnValue(false);
    const report = await service.checkReadiness();
    expect(report.dependencies.discord).toBe('down');
    expect(report.status).toBe('unavailable');
  });

  it('returns unavailable if Lavalink rejects credentials', async () => {
    const { service } = setup();
    globalThis.fetch = jest.fn().mockResolvedValue({ ok: false });
    const report = await service.checkReadiness();
    expect(report.dependencies.lavalink).toBe('down');
    expect(report.status).toBe('unavailable');
  });

  it('reuses concurrent checks and short-lived cached results', async () => {
    const { service, data } = setup();
    const [first, second, third] = await Promise.all([
      service.checkReadiness(),
      service.checkReadiness(),
      service.checkReadiness(),
    ]);
    expect(first).toEqual(second);
    expect(second).toEqual(third);
    await service.checkReadiness();
    expect(data.query).toHaveBeenCalledTimes(1);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
  });

  it('handles failed database queries and Lavalink connection errors', async () => {
    const { service, data } = setup();
    jest.spyOn(data, 'query').mockRejectedValue(new Error('DB unavailable'));
    globalThis.fetch = jest.fn().mockRejectedValue(new Error('Node unavailable'));
    const report = await service.checkReadiness();
    expect(report.status).toBe('unavailable');
    expect(report.dependencies).toEqual({
      database: 'down', discord: 'up', lavalink: 'down',
    });
  });
});
