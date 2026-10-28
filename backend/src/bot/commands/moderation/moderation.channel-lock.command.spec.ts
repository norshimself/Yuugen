import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { ModerationCommands } from './moderation.command';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { ModerationChannelLockService } from '../../../domain/moderation/moderation-channel-lock.service';

describe('Channel lock Discord interactions', () => {
  const guildId = '123456789012345678';
  const channelId = '234567890123456789';
  const actorId = '345678901234567890';
  const otherId = '456789012345678901';
  const messageId = '567890123456789012';
  const SEND = 1n << 11n;

  function setup(options: {
    actorAllowed?: boolean;
    botAllowed?: boolean;
    synced?: boolean;
    originalExisted?: boolean;
    originalAllow?: bigint;
    originalDeny?: bigint;
  } = {}) {
    let overwrite: {
      allow: { bitfield: bigint };
      deny: { bitfield: bigint };
    } | undefined = options.originalExisted
      ? {
        allow: { bitfield: options.originalAllow ?? 0n },
        deny: { bitfield: options.originalDeny ?? 0n },
      }
      : undefined;
    let active: any = null;
    const actor = { id: actorId };
    const bot = { id: otherId };
    const actorPermissions = {
      has: jest.fn().mockReturnValue(options.actorAllowed !== false),
    };
    const botPermissions = {
      has: jest.fn().mockReturnValue(options.botAllowed !== false),
    };
    const channel = {
      id: channelId,
      guildId,
      guild: { id: guildId },
      type: ChannelType.GuildText,
      permissionsLocked: options.synced === true,
      permissionsFor: jest.fn((member: unknown) =>
        member === actor ? actorPermissions : member === bot ? botPermissions : null),
      permissionOverwrites: {
        cache: {
          get: jest.fn(() => overwrite),
        },
        edit: jest.fn(async (_role: unknown, change: { SendMessages: boolean | null }) => {
          const allow = overwrite?.allow.bitfield ?? 0n;
          const deny = overwrite?.deny.bitfield ?? 0n;
          overwrite = {
            allow: {
              bitfield: change.SendMessages === true
                ? allow | SEND : allow & ~SEND,
            },
            deny: {
              bitfield: change.SendMessages === false
                ? deny | SEND : deny & ~SEND,
            },
          };
          return channel;
        }),
        delete: jest.fn(async () => {
          overwrite = undefined;
          return channel;
        }),
      },
    };
    const guild = {
      id: guildId,
      roles: { everyone: { id: guildId } },
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
      members: {
        fetch: jest.fn().mockResolvedValue(actor),
        fetchMe: jest.fn().mockResolvedValue(bot),
      },
    };
    const slash = {
      guild,
      guildId,
      channelId,
      user: { id: actorId },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue({ id: messageId }),
    };
    const button = {
      guild,
      guildId,
      message: { id: messageId },
      user: { id: actorId },
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      reply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const locks = {
      getActive: jest.fn(async () => active),
      beginLock: jest.fn(async (
        recordedGuild: string, recordedChannel: string,
        user: string, reason: string, snapshot: any,
      ) => {
        if (active) return null;
        active = {
          id: 77, guildId: recordedGuild, channelId: recordedChannel,
          lockedByUserId: user, lockReason: reason,
          status: 'lock_pending', ...snapshot,
        };
        return active;
      }),
      finishLock: jest.fn(async (_g: string, _id: number, status: string) => {
        active = { ...active, status };
        const result = active;
        if (status === 'failed') active = null;
        return result;
      }),
      beginUnlock: jest.fn(async (_g: string, _id: number, _a: string) => {
        if (active?.status !== 'locked') return null;
        active = { ...active, status: 'unlock_pending' };
        return active;
      }),
      finishUnlock: jest.fn(async (_g: string, _id: number, status: string) => {
        active = { ...active, status };
        const result = active;
        if (status === 'unlocked') active = null;
        return result;
      }),
    } as unknown as ModerationChannelLockService;
    const commands = new ModerationCommands(
      {} as ModerationService, undefined, locks,
    );
    const lockOptions = {
      reason: 'Safety review',
      channel: undefined,
    };
    const unlockOptions = {
      reason: 'Issue resolved',
      channel: undefined,
    };
    return {
      commands, locks, channel, slash, button, guild, actorPermissions,
      botPermissions, lockOptions, unlockOptions,
      readOverwrite: () => overwrite,
      setOverwrite: (allow: bigint, deny: bigint) => {
        overwrite = { allow: { bitfield: allow }, deny: { bitfield: deny } };
      },
      activeLock: () => active,
    };
  }

  async function previewLock(s: ReturnType<typeof setup>) {
    return s.commands.onLock([s.slash] as any, s.lockOptions);
  }
  async function previewUnlock(s: ReturnType<typeof setup>) {
    return s.commands.onUnlock([s.slash] as any, s.unlockOptions);
  }
  async function lockChannel(s: ReturnType<typeof setup>) {
    await previewLock(s);
    return s.commands.onLockConfirm([s.button] as any);
  }

  it('previews lock without changing Discord or writing a DB case', async () => {
    const s = setup();
    await previewLock(s);
    expect(s.channel.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(s.locks.beginLock).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Confirm channel lock'),
      components: expect.any(Array),
      allowedMentions: { parse: [] },
    }));
  });

  it('requires both Manage Roles and Manage Channels for actor and bot', async () => {
    for (const kind of ['actor', 'bot'] as const) {
      const s = setup();
      const perms = kind === 'actor'
        ? s.actorPermissions : s.botPermissions;
      perms.has.mockImplementation((bit: bigint) =>
        bit !== PermissionFlagsBits.ManageRoles);
      await previewLock(s);
      expect(s.locks.getActive).not.toHaveBeenCalled();
      expect(s.channel.permissionOverwrites.edit).not.toHaveBeenCalled();
      expect(s.slash.editReply).toHaveBeenCalledWith(
        expect.stringContaining(kind === 'actor' ? 'You need' : 'Yuugen needs'),
      );
    }
  });

  it('refuses category-synced channels to avoid silently breaking sync', async () => {
    const s = setup({ synced: true });
    await previewLock(s);
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('syncs permissions'),
    );
    expect(s.locks.beginLock).not.toHaveBeenCalled();
  });

  it('refuses an existing manual @everyone deny not owned by Yuugen', async () => {
    const s = setup({ originalExisted: true, originalDeny: SEND });
    await previewLock(s);
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('already denied'),
    );
    expect(s.locks.beginLock).not.toHaveBeenCalled();
  });

  it('records a snapshot first and only then denies SendMessages', async () => {
    const s = setup();
    await lockChannel(s);
    expect(s.locks.beginLock).toHaveBeenCalledWith(
      guildId, channelId, actorId, 'Safety review',
      expect.objectContaining({
        originalExisted: false, originalAllow: '0',
        originalDeny: '0', lockedAllow: '0', lockedDeny: SEND.toString(),
      }),
    );
    expect(s.channel.permissionOverwrites.edit).toHaveBeenCalledWith(
      s.guild.roles.everyone,
      { SendMessages: false },
      expect.objectContaining({ reason: expect.stringContaining('lock #77') }),
    );
    expect(s.locks.finishLock).toHaveBeenCalledWith(guildId, 77, 'locked');
    expect((s.locks.beginLock as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(s.channel.permissionOverwrites.edit.mock.invocationCallOrder[0]);
    expect(s.readOverwrite()?.deny.bitfield).toBe(SEND);
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('locked'), components: [],
    }));
  });

  it('restores a originally nonexistent overwrite by deleting only that overwrite', async () => {
    const s = setup();
    await lockChannel(s);
    await previewUnlock(s);
    await s.commands.onUnlockConfirm([s.button] as any);
    expect(s.locks.beginUnlock).toHaveBeenCalledWith(
      guildId, 77, actorId, 'Issue resolved',
    );
    expect(s.channel.permissionOverwrites.delete).toHaveBeenCalledWith(
      guildId, expect.stringContaining('lock #77'),
    );
    expect(s.locks.finishUnlock).toHaveBeenCalledWith(guildId, 77, 'unlocked');
    expect(s.readOverwrite()).toBeUndefined();
  });

  it('restores an original explicit allow while preserving other role bits', async () => {
    const s = setup({ originalExisted: true, originalAllow: SEND | 8n });
    await lockChannel(s);
    expect(s.readOverwrite()?.allow.bitfield).toBe(8n);
    await previewUnlock(s);
    await s.commands.onUnlockConfirm([s.button] as any);
    expect(s.channel.permissionOverwrites.edit).toHaveBeenLastCalledWith(
      s.guild.roles.everyone,
      { SendMessages: true },
      expect.any(Object),
    );
    expect(s.readOverwrite()?.allow.bitfield).toBe(SEND | 8n);
    expect(s.readOverwrite()?.deny.bitfield).toBe(0n);
    expect(s.channel.permissionOverwrites.delete).not.toHaveBeenCalled();
  });

  it('restores an inherited SendMessages bit while keeping an existing overwrite', async () => {
    const s = setup({ originalExisted: true, originalAllow: 8n });
    await lockChannel(s);
    await previewUnlock(s);
    await s.commands.onUnlockConfirm([s.button] as any);
    expect(s.channel.permissionOverwrites.edit).toHaveBeenLastCalledWith(
      s.guild.roles.everyone,
      { SendMessages: null },
      expect.any(Object),
    );
    expect(s.readOverwrite()?.allow.bitfield).toBe(8n);
    expect(s.readOverwrite()?.deny.bitfield).toBe(0n);
    expect(s.channel.permissionOverwrites.delete).not.toHaveBeenCalled();
  });

  it('shows audited status privately to authorized moderators', async () => {
    const s = setup();
    await lockChannel(s);
    await s.commands.onLockStatus([s.slash] as any, { channel: undefined });
    expect(s.slash.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Lock case #77'),
      allowedMentions: { parse: [] },
    }));
  });

  it('refuses to unlock if anyone changes any overwrite bit afterwards', async () => {
    const s = setup();
    await lockChannel(s);
    s.setOverwrite(8n, SEND);
    await previewUnlock(s);
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Refusing to overwrite staff changes'),
    );
    expect(s.locks.beginUnlock).not.toHaveBeenCalled();
  });

  it('cancels unlock if permission bits change after confirmation preview', async () => {
    const s = setup();
    await lockChannel(s);
    await previewUnlock(s);
    s.setOverwrite(8n, SEND);
    await s.commands.onUnlockConfirm([s.button] as any);
    expect(s.locks.beginUnlock).not.toHaveBeenCalled();
    expect(s.channel.permissionOverwrites.delete).not.toHaveBeenCalled();
  });

  it('rechecks bot/actor permissions immediately before Discord mutation', async () => {
    for (const kind of ['actor', 'bot'] as const) {
      const s = setup();
      await previewLock(s);
      (kind === 'actor' ? s.actorPermissions : s.botPermissions)
        .has.mockReturnValue(false);
      await s.commands.onLockConfirm([s.button] as any);
      expect(s.locks.beginLock).not.toHaveBeenCalled();
      expect(s.channel.permissionOverwrites.edit).not.toHaveBeenCalled();
    }
  });

  it('rejects confirmations from other users or guilds', async () => {
    const s = setup();
    await previewLock(s);
    s.button.user.id = otherId;
    await s.commands.onLockConfirm([s.button] as any);
    s.button.user.id = actorId;
    s.button.guildId = otherId;
    await s.commands.onLockConfirm([s.button] as any);
    expect(s.button.reply).toHaveBeenCalledTimes(2);
    expect(s.locks.beginLock).not.toHaveBeenCalled();
  });

  it('cancels and expires confirmations without changing permissions', async () => {
    const canceled = setup();
    await previewLock(canceled);
    await canceled.commands.onLockCancel([canceled.button] as any);
    await canceled.commands.onLockConfirm([canceled.button] as any);
    expect(canceled.channel.permissionOverwrites.edit).not.toHaveBeenCalled();

    const expired = setup();
    await previewLock(expired);
    const pending = (expired.commands as unknown as {
      pendingChannelLocks: Map<string, { expiresAt: number }>;
    }).pendingChannelLocks;
    pending.get(messageId)!.expiresAt = Date.now() - 1;
    await expired.commands.onLockConfirm([expired.button] as any);
    expect(expired.locks.beginLock).not.toHaveBeenCalled();
  });

  it('never changes Discord permissions when saving the lock fails', async () => {
    const s = setup();
    (s.locks.beginLock as jest.Mock).mockRejectedValue(new Error('DB offline'));
    await previewLock(s);
    await s.commands.onLockConfirm([s.button] as any);
    expect(s.channel.permissionOverwrites.edit).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('could not save lock audit'),
    }));
  });

  it('does not restore permissions if saving unlock intent fails', async () => {
    const s = setup();
    await lockChannel(s);
    await previewUnlock(s);
    (s.locks.beginUnlock as jest.Mock).mockRejectedValue(new Error('DB offline'));
    await s.commands.onUnlockConfirm([s.button] as any);
    expect(s.channel.permissionOverwrites.delete).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('could not save unlock audit'),
    }));
  });

  it('records definitive Discord permission rejection and frees lock reservation', async () => {
    const s = setup();
    s.channel.permissionOverwrites.edit.mockRejectedValueOnce({
      status: 403, code: 50013,
    });
    await lockChannel(s);
    expect(s.locks.finishLock).toHaveBeenCalledWith(guildId, 77, 'failed');
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Discord denied'),
    }));
  });

  it('keeps ambiguous Discord failures as pending for manual reconciliation', async () => {
    const s = setup();
    s.channel.permissionOverwrites.edit.mockRejectedValueOnce(
      new Error('Connection timed out'),
    );
    await lockChannel(s);
    expect(s.locks.finishLock).not.toHaveBeenCalled();
    expect(s.activeLock()?.status).toBe('lock_pending');
  });

  it('returns to locked status when Discord definitively rejects unlock', async () => {
    const s = setup();
    await lockChannel(s);
    await previewUnlock(s);
    s.channel.permissionOverwrites.delete.mockRejectedValueOnce({
      status: 403, code: 50013,
    });
    await s.commands.onUnlockConfirm([s.button] as any);
    expect(s.locks.finishUnlock).toHaveBeenCalledWith(guildId, 77, 'locked');
    expect(s.activeLock()?.status).toBe('locked');
  });

  it('leaves an ambiguous unlock pending without retrying', async () => {
    const s = setup();
    await lockChannel(s);
    await previewUnlock(s);
    s.channel.permissionOverwrites.delete.mockRejectedValueOnce(
      new Error('Connection timed out'),
    );
    await s.commands.onUnlockConfirm([s.button] as any);
    expect(s.locks.finishUnlock).not.toHaveBeenCalled();
    expect(s.activeLock()?.status).toBe('unlock_pending');
  });

  it('reports a successful Discord lock with failed DB finalization', async () => {
    const s = setup();
    (s.locks.finishLock as jest.Mock).mockRejectedValueOnce(
      new Error('DB unavailable'),
    );
    await lockChannel(s);
    expect(s.channel.permissionOverwrites.edit).toHaveBeenCalledTimes(1);
    expect(s.activeLock()?.status).toBe('lock_pending');
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('still pending'),
    }));
  });

  it('prevents duplicate actions from rapid confirmation clicks', async () => {
    const s = setup();
    await previewLock(s);
    await Promise.all([
      s.commands.onLockConfirm([s.button] as any),
      s.commands.onLockConfirm([s.button] as any),
    ]);
    expect(s.locks.beginLock).toHaveBeenCalledTimes(1);
    expect(s.channel.permissionOverwrites.edit).toHaveBeenCalledTimes(1);
  });

  it('does not unlock a channel that was never locked by Yuugen', async () => {
    const s = setup();
    await previewUnlock(s);
    expect(s.locks.beginUnlock).not.toHaveBeenCalled();
    expect(s.channel.permissionOverwrites.delete).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('no active Yuugen-managed lock'),
    );
  });

  it('refuses other-guild channels in slash command options', async () => {
    const s = setup();
    await s.commands.onLock([s.slash] as any, {
      reason: 'Reason',
      channel: { guildId: otherId, id: channelId },
    });
    expect(s.guild.channels.fetch).not.toHaveBeenCalled();
    expect(s.locks.beginLock).not.toHaveBeenCalled();
  });
});
