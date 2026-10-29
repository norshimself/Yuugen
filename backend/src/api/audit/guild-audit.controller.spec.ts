import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { GuildAuditController } from './guild-audit.controller';
import { DEFAULT_GUILD_AUDIT } from '../../domain/audit/guild-audit-policy';

describe('GuildAuditController: guarded guild admin configuration', () => {
  const guildId = '123456789012345678';
  const channelId = '234567890123456789';
  const enabled = {
    enabled: true, logChannelId: channelId,
    selectedEvents: ['message_edit', 'message_delete'],
  } as const;
  function setup() {
    const audit = {
      getConfig: jest.fn().mockResolvedValue(DEFAULT_GUILD_AUDIT),
      history: jest.fn().mockResolvedValue([]),
      setConfig: jest.fn().mockResolvedValue(enabled),
    };
    const everyone = { id: 'everyone' };
    const bot = {
      id: 'bot', permissions: { has: jest.fn().mockReturnValue(true) },
    };
    const canBot = jest.fn().mockReturnValue(true);
    const canEveryone = jest.fn().mockReturnValue(false);
    const permissionsFor = jest.fn((member: unknown) => ({
      has: member === everyone ? canEveryone : canBot,
    }));
    const channel = { type: ChannelType.GuildText as ChannelType, permissionsFor };
    const guild = {
      roles: { everyone },
      members: { me: bot, fetchMe: jest.fn().mockResolvedValue(bot) },
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
    };
    const client = { guilds: { cache: new Map([[guildId, guild]]) } };
    const config = { get: jest.fn().mockReturnValue('true') };
    return {
      audit, guild, bot, config, channel, permissionsFor, canBot, canEveryone,
      controller: new GuildAuditController(audit as any, client as any, config as any),
    };
  }

  it('reads only the manager-authorized guild via guarded endpoints', async () => {
    const x = setup();
    await x.controller.get(guildId);
    await x.controller.history(guildId);
    expect(x.audit.getConfig).toHaveBeenCalledWith(guildId);
    expect(x.audit.history).toHaveBeenCalledWith(guildId);
  });

  it('rejects unexpected event kinds and missing channel without saving', async () => {
    const x = setup();
    await expect(x.controller.configure({ guildId, settings: {
      enabled: true, logChannelId: channelId,
      selectedEvents: ['arbitrary' as any],
    } })).rejects.toThrow('events');
    await expect(x.controller.configure({ guildId, settings: {
      enabled: true, logChannelId: null, selectedEvents: ['message_edit'],
    } })).rejects.toThrow('requires');
    expect(x.audit.setConfig).not.toHaveBeenCalled();
  });

  it('requires a writable guild text channel with @everyone denied View Channel', async () => {
    const x = setup();
    x.channel.type = ChannelType.GuildVoice;
    await expect(x.controller.configure({ guildId, settings: { ...enabled, selectedEvents: [...enabled.selectedEvents] } }))
      .rejects.toThrow('writable');
    x.channel.type = ChannelType.GuildText;
    x.canBot.mockReturnValue(false);
    await expect(x.controller.configure({ guildId, settings: { ...enabled, selectedEvents: [...enabled.selectedEvents] } }))
      .rejects.toThrow('writable');
    x.canBot.mockReturnValue(true);
    x.canEveryone.mockReturnValue(true);
    await expect(x.controller.configure({ guildId, settings: { ...enabled, selectedEvents: [...enabled.selectedEvents] } }))
      .rejects.toThrow('private');
    x.canEveryone.mockReturnValue(false);
    await x.controller.configure({ guildId, settings: { ...enabled, selectedEvents: [...enabled.selectedEvents] } });
    expect(x.audit.setConfig).toHaveBeenCalledWith(guildId, enabled);
  });

  it('requires configured intents for member and moderation events', async () => {
    const x = setup();
    x.config.get.mockReturnValue('false');
    await expect(x.controller.configure({ guildId, settings: {
      enabled: true, logChannelId: channelId,
      selectedEvents: ['member_join'],
    } })).rejects.toThrow('Guild Members');
    await expect(x.controller.configure({ guildId, settings: {
      enabled: true, logChannelId: channelId,
      selectedEvents: ['member_ban'],
    } })).rejects.toThrow('Guild Moderation');
    expect(x.audit.setConfig).not.toHaveBeenCalled();
  });

  it('requires View Audit Log for kick attribution', async () => {
    const x = setup();
    x.bot.permissions.has.mockReturnValue(false);
    await expect(x.controller.configure({ guildId, settings: {
      enabled: true, logChannelId: channelId,
      selectedEvents: ['member_kick'],
    } })).rejects.toThrow('View Audit Log');
    expect(x.bot.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.ViewAuditLog);
  });

  it('allows immediate disable even when the destination or intent is unavailable', async () => {
    const x = setup();
    x.guild.channels.fetch.mockResolvedValue(null);
    x.config.get.mockReturnValue('false');
    await x.controller.configure({
      guildId, settings: { enabled: false,
        logChannelId: channelId, selectedEvents: ['member_kick'] },
    });
    expect(x.audit.setConfig).toHaveBeenCalledWith(guildId, {
      enabled: false, logChannelId: channelId, selectedEvents: ['member_kick'],
    });
    expect(x.guild.channels.fetch).not.toHaveBeenCalled();
  });
  it('requires Guild Moderation intent and View Audit Log for structural entries', async () => {
    const x = setup();
    const structural = {
      guildId, settings: { enabled: true, logChannelId: channelId,
        selectedEvents: ['role_create' as const], retentionDays: 7 },
    };
    x.config.get.mockReturnValueOnce('false');
    await expect(x.controller.configure(structural))
      .rejects.toThrow('Guild Moderation');
    x.bot.permissions.has.mockReturnValue(false);
    await expect(x.controller.configure(structural))
      .rejects.toThrow('View Audit Log');
    x.bot.permissions.has.mockReturnValue(true);
    await x.controller.configure(structural);
    expect(x.audit.setConfig).toHaveBeenCalledWith(guildId, structural.settings);
  });

  it('bounds manager-configured retention and preserves safe disable path', async () => {
    const x = setup();
    const payload = {
      guildId, settings: {
        enabled: true, logChannelId: channelId,
        selectedEvents: ['webhook_delete' as const], retentionDays: 31,
      },
    };
    await expect(x.controller.configure(payload)).rejects.toThrow('Retention');
    expect(x.audit.setConfig).not.toHaveBeenCalled();
    x.guild.channels.fetch.mockResolvedValue(null);
    await x.controller.configure({
      guildId, settings: { ...payload.settings, enabled: false, retentionDays: 1 },
    });
    expect(x.audit.setConfig).toHaveBeenCalledWith(guildId,
      { ...payload.settings, enabled: false, retentionDays: 1 });
  });


});
