import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { SettingsController } from './settings.controller';

describe('SettingsController: onboarding destinations (#62)', () => {
  const guildId = '123456789012345678';
  const welcomeId = '234567890123456789';
  const goodbyeId = '345678901234567890';
  const rulesId = '456789012345678901';
  function setup() {
    const stored = {
      welcomeChannelId: welcomeId, goodbyeChannelId: null,
      welcomeDmEnabled: false, rulesAcknowledgementEnabled: false,
      rulesChannelId: null,
    };
    const service = {
      getSettings: jest.fn().mockResolvedValue(stored),
      updateSettings: jest.fn().mockResolvedValue(stored),
    };
    const bot = { id: '567890123456789012' };
    const everyone = { id: guildId };
    const botCan = jest.fn().mockReturnValue(true);
    const memberCan = jest.fn().mockReturnValue(true);
    const channel = {
      type: ChannelType.GuildText as ChannelType,
      permissionsFor: jest.fn((member: unknown) => ({
        has: member === everyone ? memberCan : botCan,
      })),
    };
    const guild = {
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
      members: { me: bot, fetchMe: jest.fn() },
      roles: { everyone },
    };
    const client = { guilds: { cache: new Map([[guildId, guild]]) } };
    return {
      service, client, botCan, memberCan, guild, channel,
      controller: new SettingsController(service as any, client as any),
    };
  }

  it('permits clearing goodbye and welcome channels without arbitrary fallback', async () => {
    const x = setup();
    await x.controller.updateSettings({
      guildId, settings: { welcomeChannelId: '', goodbyeChannelId: null },
    });
    expect(x.guild.channels.fetch).not.toHaveBeenCalled();
    expect(x.service.updateSettings).toHaveBeenCalledWith(guildId, {
      welcomeChannelId: '', goodbyeChannelId: null,
    });
  });

  it('requires selected goodbye and welcome channels to be guild-owned and writable', async () => {
    const x = setup();
    await x.controller.updateSettings({
      guildId, settings: { goodbyeChannelId: goodbyeId },
    });
    expect(x.guild.channels.fetch).toHaveBeenCalledWith(goodbyeId);
    x.botCan.mockReturnValue(false);
    await expect(x.controller.updateSettings({
      guildId, settings: { welcomeChannelId: welcomeId },
    })).rejects.toThrow('text channel');
    expect(x.service.updateSettings).toHaveBeenCalledTimes(1);
  });

  it('requires a rules link accessible to new members, but not bot SendMessages', async () => {
    const x = setup();
    x.memberCan.mockReturnValue(false);
    const body = {
      guildId, settings: {
        welcomeDmEnabled: true, rulesAcknowledgementEnabled: true,
        rulesChannelId: rulesId,
      },
    };
    await expect(x.controller.updateSettings(body)).rejects.toThrow('visible');
    x.memberCan.mockReturnValue(true);
    x.botCan.mockImplementation((flag: bigint) =>
      flag !== PermissionFlagsBits.SendMessages);
    await x.controller.updateSettings(body);
    expect(x.service.updateSettings).toHaveBeenCalledWith(guildId, body.settings);
  });

  it('requires actual text channel and valid IDs for selected options', async () => {
    const x = setup();
    await expect(x.controller.updateSettings({
      guildId, settings: { goodbyeChannelId: 'not-id' },
    })).rejects.toThrow('Invalid');
    x.channel.type = ChannelType.GuildVoice;
    await expect(x.controller.updateSettings({
      guildId, settings: { goodbyeChannelId: goodbyeId },
    })).rejects.toThrow('text channel');
    expect(x.service.updateSettings).not.toHaveBeenCalled();
  });

  it('does not lock out disabling rules when the old channel was deleted', async () => {
    const x = setup();
    x.guild.channels.fetch.mockResolvedValue(null);
    await x.controller.updateSettings({
      guildId, settings: {
        rulesAcknowledgementEnabled: false, welcomeDmEnabled: false,
        rulesChannelId: null,
      },
    });
    expect(x.guild.channels.fetch).not.toHaveBeenCalled();
    expect(x.service.updateSettings).toHaveBeenCalled();
  });

  it('rejects enabling rules without a valid DM and channel pairing', async () => {
    const x = setup();
    await expect(x.controller.updateSettings({
      guildId, settings: { rulesAcknowledgementEnabled: true },
    })).rejects.toThrow('requires welcome DM');
    expect(x.service.updateSettings).not.toHaveBeenCalled();
  });
});
