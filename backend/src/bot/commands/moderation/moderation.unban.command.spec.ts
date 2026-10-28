import { PermissionFlagsBits } from 'discord.js';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { ModerationCommands } from './moderation.command';

describe('Moderation unban Discord commands', () => {
  const guildId = '123456789012345678';
  const staffId = '234567890123456789';
  const targetId = '345678901234567890';
  const ownerId = '456789012345678901';
  const messageId = '567890123456789012';

  function setup(options: { actorCanBan?: boolean; botCanBan?: boolean } = {}) {
    const staff = {
      permissions: {
        has: jest.fn().mockReturnValue(options.actorCanBan !== false),
      },
    };
    const bot = {
      permissions: {
        has: jest.fn().mockReturnValue(options.botCanBan !== false),
      },
    };
    const guild = {
      id: guildId,
      ownerId,
      members: {
        fetch: jest.fn(async ({ user }: { user: string }) =>
          user === staffId ? staff : null),
        fetchMe: jest.fn().mockResolvedValue(bot),
      },
      bans: {
        fetch: jest.fn().mockResolvedValue({ user: { id: targetId } }),
        remove: jest.fn().mockResolvedValue({ id: targetId }),
      },
    };
    const slash = {
      guild,
      guildId,
      user: { id: staffId },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue({ id: messageId }),
    };
    const button = {
      guild,
      guildId,
      user: { id: staffId },
      message: { id: messageId },
      reply: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };
    const service = {
      beginUnban: jest.fn().mockResolvedValue({ id: 52 }),
      finalizeUnban: jest.fn().mockResolvedValue({ id: 52, action: 'unban' }),
      casesForUser: jest.fn().mockResolvedValue([]),
    } as unknown as ModerationService;
    return {
      commands: new ModerationCommands(service),
      slash, button, guild, staff, bot, service,
    };
  }

  async function preview(s: ReturnType<typeof setup>) {
    await s.commands.onUnban([s.slash] as any, {
      userId: targetId, reason: 'Appeal approved',
    });
  }

  it('looks up the live ban and displays a private confirmation without unbanning', async () => {
    const s = setup();
    await preview(s);
    expect(s.guild.bans.fetch).toHaveBeenCalledWith(targetId);
    expect(s.guild.bans.remove).not.toHaveBeenCalled();
    expect(s.service.beginUnban).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Confirm unban'),
      allowedMentions: { parse: [] },
      components: expect.any(Array),
    }));
  });

  it('rejects moderators without Ban Members before querying bans', async () => {
    const s = setup({ actorCanBan: false });
    await preview(s);
    expect(s.guild.bans.fetch).not.toHaveBeenCalled();
    expect(s.service.beginUnban).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Ban Members'),
    );
  });

  it('rejects missing bot Ban Members before querying bans', async () => {
    const s = setup({ botCanBan: false });
    await preview(s);
    expect(s.guild.bans.fetch).not.toHaveBeenCalled();
    expect(s.service.beginUnban).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Yuugen needs'),
    );
  });

  it('rejects invalid target ID and empty or too-long reason', async () => {
    const s = setup();
    await s.commands.onUnban([s.slash] as any, {
      userId: 'not-a-snowflake', reason: 'Reason',
    });
    await s.commands.onUnban([s.slash] as any, {
      userId: targetId, reason: ' ',
    });
    await s.commands.onUnban([s.slash] as any, {
      userId: targetId, reason: 'x'.repeat(513),
    });
    expect(s.guild.bans.fetch).not.toHaveBeenCalled();
    expect(s.service.beginUnban).not.toHaveBeenCalled();
  });

  it('rejects self or guild-owner user IDs', async () => {
    const s = setup();
    await s.commands.onUnban([s.slash] as any, {
      userId: staffId, reason: 'Reason',
    });
    await s.commands.onUnban([s.slash] as any, {
      userId: ownerId, reason: 'Reason',
    });
    expect(s.guild.bans.fetch).not.toHaveBeenCalled();
  });

  it('rejects a user who is not banned without creating a case', async () => {
    const s = setup();
    s.guild.bans.fetch.mockRejectedValue({ status: 404, code: 10026 });
    await preview(s);
    expect(s.service.beginUnban).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('not currently banned'),
    );
  });

  it('fails closed on ban-list outages and unrelated HTTP 404 errors', async () => {
    for (const error of [new Error('Connection reset'), { status: 404, code: 10004 }]) {
      const s = setup();
      s.guild.bans.fetch.mockRejectedValue(error);
      await preview(s);
      expect(s.guild.bans.remove).not.toHaveBeenCalled();
      expect(s.service.beginUnban).not.toHaveBeenCalled();
      expect(s.slash.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Could not verify'),
      );
    }
  });

  it('confirms an unban only after saving a pending case, with audit reason', async () => {
    const s = setup();
    await preview(s);
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.guild.bans.fetch).toHaveBeenCalledTimes(2);
    expect(s.service.beginUnban).toHaveBeenCalledWith(
      guildId, targetId, staffId, 'Appeal approved',
    );
    expect(s.guild.bans.remove).toHaveBeenCalledWith(
      targetId, expect.stringContaining('case #52'),
    );
    expect(s.service.finalizeUnban).toHaveBeenCalledWith(
      guildId, 52, 'unban',
    );
    expect((s.service.beginUnban as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(s.guild.bans.remove.mock.invocationCallOrder[0]);
    expect(s.guild.bans.remove.mock.invocationCallOrder[0])
      .toBeLessThan((s.service.finalizeUnban as jest.Mock).mock.invocationCallOrder[0]);
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Unbanned'),
      allowedMentions: { parse: [] },
      components: [],
    }));
  });

  it('rejects confirmation by a different moderator or from another guild', async () => {
    const s = setup();
    await preview(s);
    s.button.user.id = ownerId;
    await s.commands.onUnbanConfirm([s.button] as any);
    s.button.user.id = staffId;
    s.button.guildId = ownerId;
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.guild.bans.remove).not.toHaveBeenCalled();
    expect(s.service.beginUnban).not.toHaveBeenCalled();
    expect(s.button.reply).toHaveBeenCalledTimes(2);
  });

  it('cancel consumes the confirmation before an unban can execute', async () => {
    const s = setup();
    await preview(s);
    await s.commands.onUnbanCancel([s.button] as any);
    expect(s.button.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('canceled'),
      components: [],
    }));
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.guild.bans.remove).not.toHaveBeenCalled();
    expect(s.service.beginUnban).not.toHaveBeenCalled();
  });

  it('does not unban after the 60-second confirmation expires', async () => {
    const s = setup();
    await preview(s);
    const pending = (s.commands as unknown as {
      pendingUnbans: Map<string, { expiresAt: number }>;
    }).pendingUnbans;
    pending.get(messageId)!.expiresAt = Date.now() - 1;
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('expired'),
    }));
    expect(s.service.beginUnban).not.toHaveBeenCalled();
    expect(s.guild.bans.remove).not.toHaveBeenCalled();
  });

  it('revalidates the moderator permissions after preview', async () => {
    const s = setup();
    await preview(s);
    s.staff.permissions.has.mockReturnValue(false);
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.service.beginUnban).not.toHaveBeenCalled();
    expect(s.guild.bans.remove).not.toHaveBeenCalled();
  });

  it('revalidates bot permissions after preview', async () => {
    const s = setup();
    await preview(s);
    s.bot.permissions.has.mockReturnValue(false);
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.service.beginUnban).not.toHaveBeenCalled();
    expect(s.guild.bans.remove).not.toHaveBeenCalled();
  });

  it('revalidates that the user is still banned before recording an unban', async () => {
    const s = setup();
    await preview(s);
    s.guild.bans.fetch.mockRejectedValueOnce({ code: 10026, status: 404 });
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.service.beginUnban).not.toHaveBeenCalled();
    expect(s.guild.bans.remove).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not currently banned'),
    }));
  });

  it('does not contact Discord if the audit write failed', async () => {
    const s = setup();
    await preview(s);
    (s.service.beginUnban as jest.Mock).mockRejectedValue(new Error('Database offline'));
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.guild.bans.remove).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('No unban attempted'),
    }));
  });

  it('records a definitive 403 failure as unban_failed', async () => {
    const s = setup();
    await preview(s);
    s.guild.bans.remove.mockRejectedValue({ status: 403, code: 50013 });
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.service.finalizeUnban).toHaveBeenCalledWith(
      guildId, 52, 'unban_failed',
    );
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Discord rejected'),
    }));
  });

  it('handles a race with another unban as an explicit Unknown Ban failure', async () => {
    const s = setup();
    await preview(s);
    s.guild.bans.remove.mockRejectedValue({ status: 404, code: 10026 });
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.service.finalizeUnban).toHaveBeenCalledWith(
      guildId, 52, 'unban_failed',
    );
  });

  it('keeps uncertain network outcomes pending for staff reconciliation', async () => {
    const s = setup();
    await preview(s);
    s.guild.bans.remove.mockRejectedValue(new Error('Timed out'));
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.service.finalizeUnban).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Check the Discord ban list'),
    }));
  });

  it('reports an unban whose database finalization failed honestly', async () => {
    const s = setup();
    await preview(s);
    (s.service.finalizeUnban as jest.Mock).mockRejectedValue(
      new Error('Database offline'),
    );
    await s.commands.onUnbanConfirm([s.button] as any);
    expect(s.guild.bans.remove).toHaveBeenCalledTimes(1);
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('still pending'),
    }));
  });

  it('can only consume a confirmation once under rapid double-clicking', async () => {
    const s = setup();
    await preview(s);
    await Promise.all([
      s.commands.onUnbanConfirm([s.button] as any),
      s.commands.onUnbanConfirm([s.button] as any),
    ]);
    expect(s.service.beginUnban).toHaveBeenCalledTimes(1);
    expect(s.guild.bans.remove).toHaveBeenCalledTimes(1);
  });

  it('keeps the earlier ban case visible through the existing case viewer', async () => {
    const s = setup();
    await s.commands.onCases([s.slash] as any, { userId: targetId });
    expect(s.service.casesForUser).toHaveBeenCalledWith(guildId, targetId);
  });
});
