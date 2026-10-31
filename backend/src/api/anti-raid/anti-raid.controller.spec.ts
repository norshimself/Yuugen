import { BadRequestException } from '@nestjs/common';
import { AntiRaidController } from './anti-raid.controller';
import { DEFAULT_ANTI_RAID_CONFIG } from '../../domain/security/anti-raid-policy';

describe('AntiRaidController settings and manual review', () => {
  const guildId = '123456789012345678';
  function setup() {
    const antiRaid = {
      getConfig: jest.fn().mockResolvedValue(DEFAULT_ANTI_RAID_CONFIG),
      recentAlerts: jest.fn().mockResolvedValue([]),
      setConfig: jest.fn().mockResolvedValue({}),
      reviewAlert: jest.fn().mockResolvedValue(true),
    };
    const permissionsFor = jest.fn().mockReturnValue({ has: jest.fn().mockReturnValue(true) });
    const channel = { type: 0, permissionsFor };
    const client = {
      guilds: { cache: new Map([[guildId, {
        channels: { fetch: jest.fn().mockResolvedValue(channel) },
        members: { me: { id: '234567890123456789' } },
      }]]) },
    };
    return {
      antiRaid, channel, permissionsFor, client,
      controller: new AntiRaidController(antiRaid as any, client as any),
    };
  }

  it('returns manager-only guild settings and alert history via guarded controller', async () => {
    const { controller, antiRaid } = setup();
    await controller.get(guildId);
    await controller.alerts(guildId);
    expect(antiRaid.getConfig).toHaveBeenCalledWith(guildId);
    expect(antiRaid.recentAlerts).toHaveBeenCalledWith(guildId);
  });

  it('rejects unauthorized action modes and enabling without a channel', async () => {
    const { controller, antiRaid } = setup();
    await expect(controller.configure({
      guildId, settings: { ...DEFAULT_ANTI_RAID_CONFIG, mode: 'quarantine' as any },
    })).rejects.toThrow('alert_only');
    await expect(controller.configure({
      guildId, settings: { ...DEFAULT_ANTI_RAID_CONFIG, enabled: true },
    })).rejects.toThrow('alert channel');
    expect(antiRaid.setConfig).not.toHaveBeenCalled();
  });

  it('validates a writable text channel in the same guild before enabling', async () => {
    const { controller, channel, permissionsFor, antiRaid } = setup();
    const body = {
      guildId, settings: { ...DEFAULT_ANTI_RAID_CONFIG, enabled: true,
        alertChannelId: '345678901234567890' },
    };
    permissionsFor.mockReturnValueOnce({ has: jest.fn().mockReturnValue(false) });
    await expect(controller.configure(body)).rejects.toThrow(BadRequestException);
    expect(antiRaid.setConfig).not.toHaveBeenCalled();

    channel.type = 2; // Voice channel must never be used for alerts.
    await expect(controller.configure(body)).rejects.toThrow('writable');
    channel.type = 0;
    await controller.configure(body);
    expect(antiRaid.setConfig).toHaveBeenCalledWith(guildId, body.settings);
  });

  it('attributes manual review to authenticated staff but takes no Discord action', async () => {
    const { controller, antiRaid } = setup();
    await controller.review(55, { guildId, disposition: 'legitimate' },
      { user: { id: '456789012345678901' } });
    expect(antiRaid.reviewAlert).toHaveBeenCalledWith(
      guildId, 55, '456789012345678901', 'legitimate',
    );
  });
});
