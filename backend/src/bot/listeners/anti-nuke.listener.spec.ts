import { ConfigService } from '@nestjs/config';
import { AuditLogEvent, ChannelType, PermissionFlagsBits } from 'discord.js';
import { AntiNukeService } from '../../domain/security/anti-nuke.service';
import { AntiNukeListener } from './anti-nuke.listener';

describe('AntiNukeListener: permissioned audit entry alerts', () => {
  function setup() {
    const antiNuke = {
      getConfig: jest.fn().mockResolvedValue({ enabled: true }),
      observe: jest.fn().mockResolvedValue({
        guildId: '123456789012345678', alertId: 4,
        alertChannelId: '234567890123456789', eventCount: 3,
        windowSeconds: 60, triggeredBy: 'channel_delete',
      }),
      finishAlert: jest.fn().mockResolvedValue(true),
    };
    const config = { get: jest.fn().mockReturnValue('true') };
    const bot = {
      id: '345678901234567890',
      permissions: { has: jest.fn().mockReturnValue(true) },
    };
    const send = jest.fn().mockResolvedValue({});
    const channelPermission = jest.fn().mockReturnValue({
      has: jest.fn().mockReturnValue(true),
    });
    const channel = {
      type: ChannelType.GuildText, permissionsFor: channelPermission, send,
    };
    const guild = {
      id: '123456789012345678',
      members: { me: bot, fetchMe: jest.fn().mockResolvedValue(bot) },
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
    };
    const entry = {
      id: '456789012345678901',
      action: AuditLogEvent.ChannelDelete,
      executorId: '567890123456789012',
      targetId: '678901234567890123',
      createdTimestamp: Date.now(),
      changes: [],
    };
    return {
      antiNuke, config, bot, channelPermission, channel, send, guild, entry,
      listener: new AntiNukeListener(
        antiNuke as unknown as AntiNukeService,
        config as unknown as ConfigService,
      ),
    };
  }

  it('does nothing when the optional moderation intent is not enabled', async () => {
    const x = setup();
    x.config.get.mockReturnValue('false');
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.antiNuke.getConfig).not.toHaveBeenCalled();
    expect(x.antiNuke.observe).not.toHaveBeenCalled();
  });

  it('does not inspect audit log entries when the guild did not enable alerts', async () => {
    const x = setup();
    x.antiNuke.getConfig.mockResolvedValue({ enabled: false });
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.antiNuke.observe).not.toHaveBeenCalled();
    expect(x.guild.channels.fetch).not.toHaveBeenCalled();
  });

  it('requires the bot View Audit Log permission, with no guessed actor', async () => {
    const x = setup();
    x.bot.permissions.has.mockReturnValue(false);
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.bot.permissions.has).toHaveBeenCalledWith(PermissionFlagsBits.ViewAuditLog);
    expect(x.antiNuke.observe).not.toHaveBeenCalled();
  });

  it('ignores unrecognized and harmless audit actions', async () => {
    const x = setup();
    await x.listener.onAudit([{ ...x.entry, action: AuditLogEvent.ChannelCreate }, x.guild] as any);
    await x.listener.onAudit([{ ...x.entry, action: AuditLogEvent.RoleUpdate,
      changes: [{ key: 'permissions', old: '8', new: '0' }] }, x.guild] as any);
    expect(x.antiNuke.observe).not.toHaveBeenCalled();
  });

  it('passes trusted audit IDs, not inferred actors or gateway fingerprints', async () => {
    const x = setup();
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.antiNuke.observe).toHaveBeenCalledWith(expect.objectContaining({
      guildId: x.guild.id,
      auditEntryId: x.entry.id,
      actorId: x.entry.executorId,
      targetId: x.entry.targetId,
      kind: 'channel_delete',
    }));
  });

  it('detects role privilege escalations only with explicit changes', async () => {
    const x = setup();
    await x.listener.onAudit([{ ...x.entry, action: AuditLogEvent.RoleUpdate,
      changes: [{ key: 'permissions', old: '0', new: '8' }] }, x.guild] as any);
    expect(x.antiNuke.observe).toHaveBeenCalledWith(expect.objectContaining({
      kind: 'permission_escalation',
    }));
  });

  it('posts an aggregated, mention-free staff alert and finalizes it', async () => {
    const x = setup();
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.send).toHaveBeenCalledWith({
      content: expect.stringContaining('3 privileged/deletion audit events'),
      allowedMentions: { parse: [] },
    });
    expect(x.antiNuke.finishAlert).toHaveBeenCalledWith(
      x.guild.id, 4, 'sent',
    );
  });

  it('does not send when permissions disappear, and records known failures', async () => {
    const x = setup();
    x.channelPermission.mockReturnValue({ has: jest.fn().mockReturnValue(false) });
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.send).not.toHaveBeenCalled();
    expect(x.antiNuke.finishAlert).toHaveBeenCalledWith(
      x.guild.id, 4, 'missing_permissions',
    );
  });

  it('never retries a possibly successful send when the network fails', async () => {
    const x = setup();
    x.send.mockRejectedValueOnce(new Error('timeout'));
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.antiNuke.finishAlert).not.toHaveBeenCalled();
  });

  it('performs no channel send if a worker already owns the alert bucket', async () => {
    const x = setup();
    x.antiNuke.observe.mockResolvedValue(null);
    await x.listener.onAudit([x.entry, x.guild] as any);
    expect(x.send).not.toHaveBeenCalled();
  });
});
