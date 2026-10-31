import { AuditLogEvent, PermissionFlagsBits } from 'discord.js';
import { GuildStructureAuditListener } from './guild-structure-audit.listener';

describe('GuildStructureAuditListener (#61)', () => {
  const guildId = '123456789012345678';
  const actorId = '234567890123456789';
  const targetId = '345678901234567890';
  const logChannelId = '456789012345678901';
  const botId = '567890123456789012';

  function setup() {
    const config = { get: jest.fn().mockReturnValue('true') };
    const audit = {
      getConfig: jest.fn().mockResolvedValue({
        enabled: true, logChannelId, selectedEvents: [
          'role_create', 'role_update', 'role_delete',
          'member_role_update', 'channel_create', 'channel_update', 'channel_delete',
          'webhook_create', 'webhook_update', 'webhook_delete', 'permission_change',
        ], retentionDays: 7,
      }),
    };
    const delivery = { record: jest.fn().mockResolvedValue(undefined) };
    const bot = {
      permissions: { has: jest.fn().mockReturnValue(true) },
    };
    const guild = {
      id: guildId,
      client: { user: { id: botId } },
      members: { me: bot, fetchMe: jest.fn().mockResolvedValue(bot) },
    };
    const entry = {
      id: '678901234567890123',
      action: AuditLogEvent.RoleCreate,
      executorId: actorId,
      targetId,
      createdTimestamp: Date.now(),
      changes: [{ key: 'name', new: 'SECRET ROLE NAME' }],
      reason: 'never persist or forward this reason',
    };
    return {
      config, audit, delivery, bot, guild, entry,
      listener: new GuildStructureAuditListener(
        audit as any, delivery as any, config as any,
      ),
    };
  }

  it('requires the opt-in Guild Moderation intent', async () => {
    const x = setup();
    x.config.get.mockReturnValue('false');
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.audit.getConfig).not.toHaveBeenCalled();
    expect(x.delivery.record).not.toHaveBeenCalled();
  });

  it('never loads audit configuration when the independent global audit switch is off', async () => {
    const x = setup();
    x.config.get.mockImplementation((key: string) =>
      key === 'ENABLE_GUILD_AUDIT_LOGGING' ? 'false' : 'true');
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.audit.getConfig).not.toHaveBeenCalled();
    expect(x.delivery.record).not.toHaveBeenCalled();
  });

  it('ignores unrecognized or disabled event selections', async () => {
    const x = setup();
    await x.listener.onAudit([
      { ...x.entry, action: AuditLogEvent.MessagePin }, x.guild,
    ] as any);
    x.audit.getConfig.mockResolvedValue({ enabled: true, logChannelId,
      selectedEvents: ['message_edit'] });
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.delivery.record).not.toHaveBeenCalled();
  });

  it('passes only trusted IDs and fixed field names from official audit events', async () => {
    const x = setup();
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.delivery.record).toHaveBeenCalledWith({
      guildId, eventType: 'role_create', eventId: x.entry.id, revision: 0,
      occurredAtMs: x.entry.createdTimestamp,
      observedAtMs: expect.any(Number),
      targetId, sourceChannelId: null, actorId,
      changedFields: ['name'], verifiedAuditEntry: true,
    });
    expect(JSON.stringify(x.delivery.record.mock.calls))
      .not.toContain('SECRET ROLE NAME');
    expect(JSON.stringify(x.delivery.record.mock.calls))
      .not.toContain('never persist');
  });

  it('separately classifies permission changes with no raw bitfields', async () => {
    const x = setup();
    await x.listener.onAudit([{ ...x.entry, action: AuditLogEvent.RoleUpdate,
      changes: [{ key: 'permissions', old: '0', new: '268435456' }] },
    x.guild] as any);
    expect(x.delivery.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'permission_change', changedFields: ['permissions'],
    }));
    expect(JSON.stringify(x.delivery.record.mock.calls))
      .not.toContain('268435456');
  });

  it('captures member role additions and removals from audited action only', async () => {
    const x = setup();
    await x.listener.onAudit([{ ...x.entry,
      action: AuditLogEvent.MemberRoleUpdate,
      changes: [{ key: '$add', new: [{ id: targetId, name: 'private' }] }],
    }, x.guild] as any);
    expect(x.delivery.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'member_role_update', changedFields: ['roles_added'],
    }));
    x.delivery.record.mockClear();
    await x.listener.onAudit([{ ...x.entry,
      action: AuditLogEvent.MemberRoleUpdate,
      changes: [{ key: '$remove', old: [{ id: targetId }] }],
    }, x.guild] as any);
    expect(x.delivery.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'member_role_update', changedFields: ['roles_removed'],
    }));
  });

  it('records webhook edits without exposing tokens or user supplied names', async () => {
    const x = setup();
    await x.listener.onAudit([{ ...x.entry, action: AuditLogEvent.WebhookUpdate,
      changes: [
        { key: 'name', old: 'SECRET A', new: 'SECRET B' },
        { key: 'token', old: 'RAW_TOKEN_1', new: 'RAW_TOKEN_2' },
      ] }, x.guild] as any);
    expect(x.delivery.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'webhook_update', changedFields: ['name'],
      sourceChannelId: null,
    }));
    expect(JSON.stringify(x.delivery.record.mock.calls)).not.toContain('RAW_TOKEN');
  });

  it('tags a channel update with its actual source ID to avoid audit recursion', async () => {
    const x = setup();
    await x.listener.onAudit([{ ...x.entry, action: AuditLogEvent.ChannelUpdate,
      changes: [{ key: 'topic', old: 'private', new: 'more private' }] },
    x.guild] as any);
    expect(x.delivery.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'channel_update', sourceChannelId: targetId,
    }));
    x.audit.getConfig.mockResolvedValue({ enabled: true, logChannelId: targetId,
      selectedEvents: ['channel_update'] });
    x.delivery.record.mockClear();
    await x.listener.onAudit([{ ...x.entry, action: AuditLogEvent.ChannelUpdate,
      changes: [{ key: 'topic', old: 'a', new: 'b' }] }, x.guild] as any);
    expect(x.delivery.record).not.toHaveBeenCalled();
  });

  it('never logs changes executed by Yuugen itself', async () => {
    const x = setup();
    await x.listener.onAudit([
      { ...x.entry, executorId: botId }, x.guild,
    ] as any);
    expect(x.audit.getConfig).not.toHaveBeenCalled();
    expect(x.delivery.record).not.toHaveBeenCalled();
  });

  it('requires View Audit Log and never guesses a missing actor', async () => {
    const x = setup();
    x.bot.permissions.has.mockReturnValue(false);
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.bot.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.ViewAuditLog);
    expect(x.delivery.record).not.toHaveBeenCalled();
    x.bot.permissions.has.mockReturnValue(true);
    await x.listener.onAudit([{ ...x.entry, executorId: null }, x.guild] as any);
    expect(x.delivery.record).toHaveBeenCalledWith(expect.objectContaining({
      actorId: null,
    }));
  });

  it('does not forward no-op updates or unverified overwrite changes', async () => {
    const x = setup();
    await x.listener.onAudit([{ ...x.entry, action: AuditLogEvent.RoleUpdate,
      changes: [{ key: 'permissions', old: '8', new: '8' }] },
    x.guild] as any);
    await x.listener.onAudit([{ ...x.entry,
      action: AuditLogEvent.ChannelOverwriteUpdate,
      changes: [{ key: 'allow', new: '1024' }] }, x.guild] as any);
    expect(x.delivery.record).not.toHaveBeenCalled();
  });

  it('does not infer channel or executor IDs from webhook or audit reason text', async () => {
    const x = setup();
    await x.listener.onAudit([{ ...x.entry, action: AuditLogEvent.WebhookDelete,
      executorId: null, targetId: null, changes: [],
      reason: 'by person 111111111111111111 on channel 222222222222222222' },
    x.guild] as any);
    expect(x.delivery.record).toHaveBeenCalledWith(expect.objectContaining({
      eventType: 'webhook_delete', actorId: null,
      targetId: null, sourceChannelId: null,
    }));
  });

  it('handles failure to read config without sending unverified data', async () => {
    const x = setup();
    x.audit.getConfig.mockRejectedValueOnce(new Error('staging DB unavailable'));
    await expect(x.listener.onAudit([x.entry, x.guild] as any)).resolves.toBeUndefined();
    expect(x.delivery.record).not.toHaveBeenCalled();
  });
});
