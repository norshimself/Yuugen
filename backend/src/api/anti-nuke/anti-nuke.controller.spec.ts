import { BadRequestException } from '@nestjs/common';
import { ChannelType } from 'discord.js';
import { DEFAULT_ANTI_NUKE_CONFIG } from '../../domain/security/anti-nuke-policy';
import { AntiNukeController } from './anti-nuke.controller';

describe('AntiNukeController: guild manager settings', () => {
  const guildId = '123456789012345678';
  function setup() {
    const antiNuke = {
      getConfig: jest.fn().mockResolvedValue(DEFAULT_ANTI_NUKE_CONFIG),
      recentAlerts: jest.fn().mockResolvedValue([]),
      setConfig: jest.fn().mockResolvedValue({}),
      reviewAlert: jest.fn().mockResolvedValue(true),
    };
    const permissionsFor = jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(true),
    });
    const channel = { type: ChannelType.GuildText, permissionsFor };
    const guild = {
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
      members: { me: { id: '234567890123456789' } },
    };
    const client = { guilds: { cache: new Map([[guildId, guild]]) } };
    return {
      antiNuke, permissionsFor, channel, guild,
      controller: new AntiNukeController(antiNuke as any, client as any),
    };
  }

  it('reads only a requested manager-authorized guild', async () => {
    const x = setup();
    await x.controller.config(guildId);
    await x.controller.alerts(guildId);
    expect(x.antiNuke.getConfig).toHaveBeenCalledWith(guildId);
    expect(x.antiNuke.recentAlerts).toHaveBeenCalledWith(guildId);
  });

  it('rejects arbitrary lockdown modes or malformed configuration before save', async () => {
    const x = setup();
    await expect(x.controller.configure({
      guildId, settings: { ...DEFAULT_ANTI_NUKE_CONFIG, mode: 'lockdown' as any },
    })).rejects.toThrow('alert_only');
    await expect(x.controller.configure({
      guildId, settings: { ...DEFAULT_ANTI_NUKE_CONFIG, enabled: true },
    })).rejects.toThrow('alert channel');
    expect(x.antiNuke.setConfig).not.toHaveBeenCalled();
  });

  it('requires a writable guild text channel when configured', async () => {
    const x = setup();
    const body = { guildId, settings: {
      ...DEFAULT_ANTI_NUKE_CONFIG, enabled: true,
      alertChannelId: '345678901234567890',
    } };
    x.channel.type = ChannelType.GuildVoice;
    await expect(x.controller.configure(body)).rejects.toThrow(BadRequestException);
    x.channel.type = ChannelType.GuildText;
    x.permissionsFor.mockReturnValueOnce({ has: jest.fn().mockReturnValue(false) });
    await expect(x.controller.configure(body)).rejects.toThrow('writable');
    await x.controller.configure(body);
    expect(x.antiNuke.setConfig).toHaveBeenCalledWith(guildId, body.settings);
  });

  it('accepts a manager review only with the JWT-bound reviewer ID', async () => {
    const x = setup();
    await x.controller.review(12, { guildId, disposition: 'suspicious' },
      { user: { id: '456789012345678901' } });
    expect(x.antiNuke.reviewAlert).toHaveBeenCalledWith(
      guildId, 12, '456789012345678901', 'suspicious',
    );
  });
});
