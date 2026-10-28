import { ChannelType, PermissionFlagsBits, User } from 'discord.js';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { ModerationPurgeService } from '../../../domain/moderation/moderation-purge.service';
import { ModerationCommands } from './moderation.command';

describe('Moderation purge Discord interactions', () => {
  const guildId = '123456789012345678';
  const channelId = '234567890123456789';
  const actorId = '345678901234567890';
  const targetId = '456789012345678901';
  const otherId = '567890123456789012';
  const confirmationId = '678901234567890123';

  function message(n: number, opts: Record<string, unknown> = {}) {
    const id = String(BigInt('789012345678901234') - BigInt(n));
    return {
      id, author: { id: n % 2 === 0 ? targetId : otherId },
      createdTimestamp: Date.now() - n * 1000,
      pinned: false,
      system: false,
      deletable: true,
      delete: jest.fn().mockResolvedValue(undefined),
      ...opts,
    };
  }

  function setup(options: {
    actorAllowed?: boolean;
    botAllowed?: boolean;
    historyAllowed?: boolean;
    rows?: ReturnType<typeof message>[];
  } = {}) {
    const actor = { permissions: {} };
    const bot = { permissions: {} };
    const actorPermissions = {
      has: jest.fn().mockReturnValue(options.actorAllowed !== false),
    };
    const botPermissions = {
      has: jest.fn((perm: bigint) =>
        options.botAllowed !== false &&
        (perm !== PermissionFlagsBits.ReadMessageHistory ||
          options.historyAllowed !== false)),
    };
    const rows = options.rows || [message(1), message(2), message(3)];
    const channel = {
      id: channelId,
      guildId,
      type: ChannelType.GuildText,
      permissionsFor: jest.fn((member: unknown) =>
        member === actor ? actorPermissions :
          member === bot ? botPermissions : null),
      messages: {
        fetch: jest.fn(async ({ limit, before }: {
          limit: number; before?: string; cache: false;
        }) => {
          const sorted = [...rows].sort((a, b) =>
            BigInt(a.id) > BigInt(b.id) ? -1 : 1);
          return new Map(sorted
            .filter(m => !before || BigInt(m.id) < BigInt(before))
            .slice(0, limit).map(m => [m.id, m]));
        }),
      },
      bulkDelete: jest.fn(async (selected: Array<{ id: string }>) =>
        new Map(selected.map(m => [m.id, m]))),
    };
    const guild = {
      id: guildId,
      members: {
        fetch: jest.fn().mockResolvedValue(actor),
        fetchMe: jest.fn().mockResolvedValue(bot),
      },
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
    };
    const slash = {
      guild,
      guildId,
      channelId,
      user: { id: actorId },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue({ id: confirmationId }),
    };
    const button = {
      guild,
      guildId,
      user: { id: actorId },
      message: { id: confirmationId },
      reply: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };
    const purge = {
      begin: jest.fn().mockResolvedValue({ id: 31 }),
      finish: jest.fn().mockResolvedValue({
        id: 31, status: 'completed', deletedCount: 2,
      }),
    } as unknown as ModerationPurgeService;
    const commands = new ModerationCommands(
      {} as ModerationService, purge,
    );
    const opts = {
      count: 2, reason: 'Clean spam',
      user: undefined as User | undefined,
      userId: undefined as string | undefined,
      channel: undefined,
    };
    return {
      commands, slash, button, channel, guild, actor, bot,
      actorPermissions, botPermissions, rows, purge, opts,
    };
  }

  async function preview(s: ReturnType<typeof setup>) {
    return s.commands.onPurge([s.slash] as any, s.opts);
  }

  it('previews an exact set privately without deleting or auditing', async () => {
    const s = setup();
    await preview(s);
    expect(s.channel.bulkDelete).not.toHaveBeenCalled();
    expect(s.purge.begin).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Selected:'),
      components: expect.any(Array),
      allowedMentions: { parse: [] },
    }));
  });

  it('checks channel Manage Messages for both actor and bot', async () => {
    for (const opts of [{ actorAllowed: false }, { botAllowed: false },
      { historyAllowed: false }]) {
      const s = setup(opts);
      await preview(s);
      expect(s.channel.messages.fetch).not.toHaveBeenCalled();
      expect(s.slash.editReply).toHaveBeenCalledWith(
        expect.stringContaining('Manage Messages'),
      );
    }
  });

  it('requires bounded count and a meaningful audit reason', async () => {
    const s = setup();
    for (const count of [0, 101, 1.5]) {
      s.opts.count = count;
      await preview(s);
    }
    s.opts.count = 2;
    s.opts.reason = ' ';
    await preview(s);
    expect(s.channel.messages.fetch).not.toHaveBeenCalled();
    expect(s.purge.begin).not.toHaveBeenCalled();
  });

  it('honors a specified author filter, including a former member ID', async () => {
    const s = setup();
    s.opts.userId = targetId;
    await preview(s);
    const map = (s.commands as unknown as {
      pendingPurges: Map<string, { filterUserId: string; messageIds: string[] }>;
    }).pendingPurges;
    const pending = map.get(confirmationId)!;
    expect(pending.filterUserId).toBe(targetId);
    expect(pending.messageIds).toEqual([s.rows[1].id]);
  });

  it('rejects competing author filters and malformed user IDs', async () => {
    const s = setup();
    s.opts.user = { id: targetId } as User;
    s.opts.userId = otherId;
    await preview(s);
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('either user or user_id'),
    );
    s.opts.user = undefined;
    s.opts.userId = 'not-a-user';
    await preview(s);
    expect(s.channel.messages.fetch).not.toHaveBeenCalled();
  });

  it('rejects a target channel belonging to another guild', async () => {
    const s = setup();
    s.opts.channel = {
      id: channelId, guildId: otherId,
    } as any;
    await preview(s);
    expect(s.guild.channels.fetch).not.toHaveBeenCalled();
  });

  it('does not preview deletion of pinned, old, or protected messages', async () => {
    const old = message(3, { createdTimestamp: Date.now() -
      15 * 24 * 60 * 60 * 1000 });
    const s = setup({ rows: [
      message(1, { pinned: true }),
      message(2, { deletable: false }),
      old,
    ] });
    await preview(s);
    expect(s.purge.begin).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No eligible recent messages'),
    );
  });

  it('cancels if the selected message set changed after preview', async () => {
    const s = setup();
    await preview(s);
    s.rows[0].pinned = true;
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.purge.begin).not.toHaveBeenCalled();
    expect(s.channel.bulkDelete).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('selection changed'),
    }));
  });

  it('rechecks channel permission at confirmation', async () => {
    const s = setup();
    await preview(s);
    s.botPermissions.has.mockReturnValue(false);
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.purge.begin).not.toHaveBeenCalled();
    expect(s.channel.bulkDelete).not.toHaveBeenCalled();
  });

  it('writes an audit before bulk deletion and records the result', async () => {
    const s = setup();
    await preview(s);
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.purge.begin).toHaveBeenCalledWith(expect.objectContaining({
      guildId, channelId, moderatorUserId: actorId,
      requestedCount: 2, selectedCount: undefined,
      selectedMessageIds: [s.rows[0].id, s.rows[1].id],
    }));
    expect(s.channel.bulkDelete).toHaveBeenCalledWith(
      [s.rows[0], s.rows[1]], true,
    );
    expect(s.purge.finish).toHaveBeenCalledWith(
      guildId, 31, 2, [s.rows[0].id, s.rows[1].id],
    );
    expect((s.purge.begin as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(s.channel.bulkDelete.mock.invocationCallOrder[0]);
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('deleted 2 of 2'),
      components: [],
      allowedMentions: { parse: [] },
    }));
  });

  it('deletes one message through the single-message API', async () => {
    const s = setup();
    s.opts.count = 1;
    await preview(s);
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.rows[0].delete).toHaveBeenCalledTimes(1);
    expect(s.channel.bulkDelete).not.toHaveBeenCalled();
    expect(s.purge.finish).toHaveBeenCalledWith(
      guildId, 31, 1, [s.rows[0].id],
    );
  });

  it('cancels confirmation after expiry or another moderator attempts it', async () => {
    const s = setup();
    await preview(s);
    s.button.user.id = otherId;
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.purge.begin).not.toHaveBeenCalled();
    s.button.user.id = actorId;
    const map = (s.commands as unknown as {
      pendingPurges: Map<string, { expiresAt: number }>;
    }).pendingPurges;
    map.get(confirmationId)!.expiresAt = Date.now() - 1;
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.purge.begin).not.toHaveBeenCalled();
    expect(s.channel.bulkDelete).not.toHaveBeenCalled();
  });

  it('cancels safely and cannot be confirmed afterwards', async () => {
    const s = setup();
    await preview(s);
    await s.commands.onPurgeCancel([s.button] as any);
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.button.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('canceled'),
      components: [],
    }));
    expect(s.purge.begin).not.toHaveBeenCalled();
  });

  it('never deletes if the database audit write fails', async () => {
    const s = setup();
    (s.purge.begin as jest.Mock).mockRejectedValue(new Error('DB offline'));
    await preview(s);
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.channel.bulkDelete).not.toHaveBeenCalled();
    expect(s.rows[0].delete).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('No deletion attempted'),
    }));
  });

  it('marks explicit Discord permission rejection as failed', async () => {
    const s = setup();
    s.channel.bulkDelete.mockRejectedValue({ status: 403, code: 50013 });
    await preview(s);
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.purge.finish).toHaveBeenCalledWith(guildId, 31, 2, []);
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Discord rejected'),
    }));
  });

  it('leaves transport-ambiguous deletes pending for review', async () => {
    const s = setup();
    s.channel.bulkDelete.mockRejectedValue(new Error('Connection reset'));
    await preview(s);
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.purge.finish).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('outcome unconfirmed'),
    }));
  });

  it('reports partial success using returned deleted IDs only', async () => {
    const s = setup();
    s.channel.bulkDelete.mockResolvedValueOnce(
      new Map([[s.rows[0].id, s.rows[0]]]),
    );
    (s.purge.finish as jest.Mock).mockResolvedValueOnce({
      status: 'partial',
    });
    await preview(s);
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.purge.finish).toHaveBeenCalledWith(
      guildId, 31, 2, [s.rows[0].id],
    );
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('partial'),
    }));
  });

  it('does not claim a finished audit when database finalization fails', async () => {
    const s = setup();
    (s.purge.finish as jest.Mock).mockRejectedValue(new Error('DB offline'));
    await preview(s);
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.channel.bulkDelete).toHaveBeenCalledTimes(1);
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('remains pending'),
    }));
  });

  it('consumes concurrent confirmation exactly once', async () => {
    const s = setup();
    await preview(s);
    await Promise.all([
      s.commands.onPurgeConfirm([s.button] as any),
      s.commands.onPurgeConfirm([s.button] as any),
    ]);
    expect(s.purge.begin).toHaveBeenCalledTimes(1);
    expect(s.channel.bulkDelete).toHaveBeenCalledTimes(1);
  });

  it('prevents overlapping purges in one channel while a deletion is active', async () => {
    const s = setup();
    await preview(s);
    (s.commands as unknown as {
      purgingChannels: Set<string>;
    }).purgingChannels.add(channelId);
    await s.commands.onPurgeConfirm([s.button] as any);
    expect(s.purge.begin).not.toHaveBeenCalled();
    expect(s.channel.bulkDelete).not.toHaveBeenCalled();
  });
});
