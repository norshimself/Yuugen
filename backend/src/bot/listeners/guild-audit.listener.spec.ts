import { AuditLogEvent, ChannelType } from 'discord.js';
import { GuildAuditListener } from './guild-audit.listener';

describe('GuildAuditListener: metadata-only Discord event handling', () => {
  const guildId = '123456789012345678';
  const destination = '234567890123456789';
  const messageId = '345678901234567890';
  const source = '456789012345678901';
  function setup() {
    const config = {
      get: jest.fn().mockReturnValue('true'),
    };
    const audit = {
      reserve: jest.fn().mockResolvedValue({
        id: 10, guildId, logChannelId: destination,
        eventType: 'message_edit', targetId: messageId,
        sourceChannelId: source, actorId: null,
      }),
      getConfig: jest.fn().mockResolvedValue({
        enabled: true, logChannelId: destination,
        selectedEvents: [
          'message_edit', 'message_delete', 'member_join',
          'member_departure', 'member_ban', 'member_kick', 'member_timeout',
        ],
      }),
      finish: jest.fn().mockResolvedValue(true),
    };
    const everyone = { id: 'everyone' };
    const bot = {
      permissions: { has: jest.fn().mockReturnValue(true) },
    };
    const send = jest.fn().mockResolvedValue({});
    const canBot = jest.fn().mockReturnValue(true);
    const canEveryone = jest.fn().mockReturnValue(false);
    const channel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn((member: unknown) => ({
        has: member === everyone ? canEveryone : canBot,
      })),
      send,
    };
    const guild = {
      id: guildId,
      roles: { everyone },
      members: { me: bot, fetchMe: jest.fn().mockResolvedValue(bot) },
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
    };
    const client = { guilds: { cache: new Map([[guildId, guild]]) } };
    const listener = new GuildAuditListener(audit as any, client as any, config as any);
    const message = {
      guildId, channelId: source, id: messageId,
      editedTimestamp: Date.now(), content: 'PRIVATE SECRET MUST NOT LEAK',
      author: { bot: false }, webhookId: null,
    };
    return {
      listener, audit, config, guild, bot, send, canBot, canEveryone, channel, message,
    };
  }

  it('records edit metadata without ever reading or logging message text', async () => {
    const x = setup();
    await x.listener.onMessageUpdate([{}, x.message] as any);
    expect(x.audit.reserve).toHaveBeenCalledWith(expect.objectContaining({
      guildId, eventId: messageId, eventType: 'message_edit',
      revision: x.message.editedTimestamp,
      sourceChannelId: source,
    }));
    expect(JSON.stringify(x.audit.reserve.mock.calls)).not.toContain('PRIVATE SECRET');
    expect(JSON.stringify(x.send.mock.calls)).not.toContain('PRIVATE SECRET');
    expect(x.send).toHaveBeenCalledWith({
      content: expect.stringContaining('Message edited'),
      allowedMentions: { parse: [] },
    });
  });

  it('records deletion with only a partial message ID and channel', async () => {
    const x = setup();
    await x.listener.onMessageDelete([{
      guildId, channelId: source, id: messageId,
      author: undefined, webhookId: null,
    }] as any);
    expect(x.audit.reserve).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'message_delete', revision: 0, actorId: null,
    }));
    expect(x.send).toHaveBeenCalled();
  });

  it('skips DM, bot, webhook and unverified edit timestamps', async () => {
    const x = setup();
    await x.listener.onMessageDelete([{ ...x.message, guildId: null }] as any);
    await x.listener.onMessageDelete([{ ...x.message, author: { bot: true } }] as any);
    await x.listener.onMessageDelete([{ ...x.message, webhookId: '567890123456789012' }] as any);
    await x.listener.onMessageUpdate([{}, { ...x.message, editedTimestamp: null }] as any);
    expect(x.audit.reserve).not.toHaveBeenCalled();
  });

  it('rechecks disabled or moved configuration after reserving a record', async () => {
    const x = setup();
    x.audit.getConfig.mockResolvedValue({ enabled: false,
      logChannelId: destination, selectedEvents: ['message_edit'] });
    await x.listener.onMessageUpdate([{}, x.message] as any);
    expect(x.send).not.toHaveBeenCalled();
    expect(x.audit.finish).toHaveBeenCalledWith(guildId, 10, 'config_changed');
  });

  it('fails closed when the channel is public or the bot loses permission', async () => {
    const x = setup();
    x.canEveryone.mockReturnValue(true);
    await x.listener.onMessageUpdate([{}, x.message] as any);
    expect(x.send).not.toHaveBeenCalled();
    expect(x.audit.finish).toHaveBeenCalledWith(guildId, 10, 'missing_permissions');
  });

  it('never retries an ambiguous message delivery', async () => {
    const x = setup();
    x.send.mockRejectedValue(new Error('uncertain Discord response'));
    await x.listener.onMessageUpdate([{}, x.message] as any);
    expect(x.audit.finish).not.toHaveBeenCalled();
  });

  it('records join and departure only with enabled Guild Members intent', async () => {
    const x = setup();
    const member = {
      id: '567890123456789012', user: { bot: false },
      joinedTimestamp: Date.now(), guild: x.guild,
    };
    x.config.get.mockReturnValue('false');
    await x.listener.onMemberAdd([member] as any);
    expect(x.audit.reserve).not.toHaveBeenCalled();
    x.config.get.mockReturnValue('true');
    await x.listener.onMemberAdd([member] as any);
    expect(x.audit.reserve).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'member_join', targetId: member.id,
    }));
    await x.listener.onMemberRemove([member] as any);
    expect(x.audit.reserve).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'member_departure', actorId: null,
    }));
  });

  it('tracks timeout changes without guessing the actor', async () => {
    const x = setup();
    const before = { id: '567890123456789012', user: { bot: false },
      communicationDisabledUntilTimestamp: null };
    const after = { ...before, guild: x.guild,
      communicationDisabledUntilTimestamp: Date.now() + 60000 };
    await x.listener.onMemberUpdate([before, after] as any);
    expect(x.audit.reserve).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'member_timeout', actorId: null,
    }));
    x.audit.reserve.mockClear();
    await x.listener.onMemberUpdate([after, after] as any);
    expect(x.audit.reserve).not.toHaveBeenCalled();
  });

  it('records bans only with Guild Moderation intent', async () => {
    const x = setup();
    const ban = { guild: x.guild, user: {
      bot: false, id: '567890123456789012',
    } };
    x.config.get.mockReturnValue('false');
    await x.listener.onBan([ban] as any);
    expect(x.audit.reserve).not.toHaveBeenCalled();
    x.config.get.mockReturnValue('true');
    await x.listener.onBan([ban] as any);
    expect(x.audit.reserve).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'member_ban', targetId: ban.user.id, actorId: null,
    }));
  });

  it('attributes kicks exclusively from actual Discord audit-log entries', async () => {
    const x = setup();
    const entry = {
      id: '678901234567890123', action: AuditLogEvent.MemberKick,
      targetId: '567890123456789012',
      executorId: '789012345678901234',
      createdTimestamp: Date.now(),
    };
    await x.listener.onKickAudit([entry, x.guild] as any);
    expect(x.audit.reserve).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'member_kick', eventId: entry.id,
      actorId: entry.executorId, targetId: entry.targetId,
    }));
    x.audit.reserve.mockClear();
    await x.listener.onKickAudit([{ ...entry, action: AuditLogEvent.RoleDelete }, x.guild] as any);
    expect(x.audit.reserve).not.toHaveBeenCalled();
  });

  it('rejects kicks without bot View Audit Log permission', async () => {
    const x = setup();
    x.bot.permissions.has.mockReturnValue(false);
    await x.listener.onKickAudit([{
      id: '678901234567890123', action: AuditLogEvent.MemberKick,
      targetId: '567890123456789012', executorId: null,
      createdTimestamp: Date.now(),
    }, x.guild] as any);
    expect(x.audit.reserve).not.toHaveBeenCalled();
  });
});
