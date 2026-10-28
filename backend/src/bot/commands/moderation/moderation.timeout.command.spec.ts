import { User } from 'discord.js';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { ModerationCommands } from './moderation.command';

describe('Moderation timeout and untimeout Discord interactions', () => {
  const guildId = '123456789012345678';
  const actorId = '234567890123456789';
  const targetId = '345678901234567890';
  const ownerId = '456789012345678901';
  const messageId = '567890123456789012';

  function setup(options: {
    actorAllowed?: boolean;
    botAllowed?: boolean;
    actorAbove?: boolean;
    memberModeratable?: boolean;
    targetPresent?: boolean;
    targetIsBot?: boolean;
    currentlyTimedOut?: boolean;
  } = {}) {
    const staff = {
      permissions: { has: jest.fn().mockReturnValue(options.actorAllowed !== false) },
      roles: { highest: { comparePositionTo: jest.fn().mockReturnValue(
        options.actorAbove === false ? 0 : 1,
      ) } },
    };
    const bot = {
      permissions: { has: jest.fn().mockReturnValue(options.botAllowed !== false) },
    };
    const member = {
      user: { bot: options.targetIsBot === true },
      moderatable: options.memberModeratable !== false,
      communicationDisabledUntilTimestamp: options.currentlyTimedOut
        ? Date.now() + 300_000 : null as number | null,
      roles: { highest: {} },
      timeout: jest.fn().mockResolvedValue(undefined),
    };
    const guild = {
      id: guildId, ownerId,
      members: {
        fetch: jest.fn(async ({ user }: { user: string }) =>
          user === actorId ? staff : user === targetId &&
          options.targetPresent !== false ? member : null),
        fetchMe: jest.fn().mockResolvedValue(bot),
      },
    };
    const slash = {
      guild, guildId, user: { id: actorId },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue({ id: messageId }),
    };
    const button = {
      guild, guildId, user: { id: actorId },
      message: { id: messageId },
      reply: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };
    const service = {
      beginTimedAction: jest.fn().mockResolvedValue({ id: 53 }),
      finalizeTimedAction: jest.fn().mockResolvedValue({ id: 53, action: 'timeout' }),
    } as unknown as ModerationService;
    const user = { id: targetId, bot: false } as User;
    return { commands: new ModerationCommands(service),
      slash, button, staff, bot, member, guild, service, user };
  }

  async function previewTimeout(s: ReturnType<typeof setup>, duration = '10m') {
    await s.commands.onTimeout([s.slash] as any, {
      user: s.user, duration, reason: 'Repeated spam',
    });
  }

  async function previewUntimeout(s: ReturnType<typeof setup>) {
    await s.commands.onUntimeout([s.slash] as any, {
      user: s.user, reason: 'Appeal accepted',
    });
  }

  it('previews timeout privately with a validated duration and no side effects', async () => {
    const s = setup();
    await previewTimeout(s);
    expect(s.member.timeout).not.toHaveBeenCalled();
    expect(s.service.beginTimedAction).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('10 minutes'),
      allowedMentions: { parse: [] },
      components: expect.any(Array),
    }));
  });

  it('refuses invalid duration and reason before modifying Discord', async () => {
    const s = setup();
    for (const duration of ['29d', '0m', '0.5h', '1w', '99999m']) {
      await previewTimeout(s, duration);
    }
    await s.commands.onTimeout([s.slash] as any, {
      user: s.user, duration: '10m', reason: ' ',
    });
    expect(s.member.timeout).not.toHaveBeenCalled();
    expect(s.service.beginTimedAction).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Invalid duration'),
    );
  });

  it('denies a moderator without Moderate Members', async () => {
    const s = setup({ actorAllowed: false });
    await previewTimeout(s);
    expect(s.guild.members.fetch).toHaveBeenCalledTimes(1);
    expect(s.member.timeout).not.toHaveBeenCalled();
    expect(s.service.beginTimedAction).not.toHaveBeenCalled();
  });

  it('denies missing bot permissions and improper hierarchy', async () => {
    for (const option of [
      { botAllowed: false },
      { memberModeratable: false },
      { actorAbove: false },
    ]) {
      const s = setup(option);
      await previewTimeout(s);
      expect(s.member.timeout).not.toHaveBeenCalled();
      expect(s.service.beginTimedAction).not.toHaveBeenCalled();
    }
  });

  it('rejects bot targets or nonmembers, and protects owner via the policy', async () => {
    for (const option of [{ targetIsBot: true }, { targetPresent: false }]) {
      const s = setup(option);
      await previewTimeout(s);
      expect(s.member.timeout).not.toHaveBeenCalled();
      expect(s.service.beginTimedAction).not.toHaveBeenCalled();
    }
  });

  it('does not start a second timeout while the member is already timed out', async () => {
    const s = setup({ currentlyTimedOut: true });
    await previewTimeout(s);
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('already timed out'),
    );
    expect(s.service.beginTimedAction).not.toHaveBeenCalled();
  });

  it('applies timeout only after saving a pending case, and finalizes it', async () => {
    const s = setup();
    await previewTimeout(s);
    await s.commands.onTimeoutConfirm([s.button] as any);
    expect(s.service.beginTimedAction).toHaveBeenCalledWith(
      guildId, targetId, actorId, 'Repeated spam', 'timeout', 600_000,
    );
    expect(s.member.timeout).toHaveBeenCalledWith(
      600_000, expect.stringContaining('case #53'),
    );
    expect(s.service.finalizeTimedAction).toHaveBeenCalledWith(
      guildId, 53, 'timeout', 'success',
    );
    expect((s.service.beginTimedAction as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(s.member.timeout.mock.invocationCallOrder[0]);
    expect(s.member.timeout.mock.invocationCallOrder[0])
      .toBeLessThan((s.service.finalizeTimedAction as jest.Mock).mock.invocationCallOrder[0]);
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Timed out'),
      allowedMentions: { parse: [] },
      components: [],
    }));
  });

  it('previews an existing timeout removal without changing it', async () => {
    const s = setup({ currentlyTimedOut: true });
    await previewUntimeout(s);
    expect(s.member.timeout).not.toHaveBeenCalled();
    expect(s.service.beginTimedAction).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('remove timeout'),
      allowedMentions: { parse: [] },
    }));
  });

  it('refuses to remove a timeout that is already expired', async () => {
    const s = setup();
    await previewUntimeout(s);
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('not currently timed out'),
    );
    expect(s.service.beginTimedAction).not.toHaveBeenCalled();
  });

  it('removes a timeout by passing null, with an independent audit case', async () => {
    const s = setup({ currentlyTimedOut: true });
    await previewUntimeout(s);
    await s.commands.onUntimeoutConfirm([s.button] as any);
    expect(s.service.beginTimedAction).toHaveBeenCalledWith(
      guildId, targetId, actorId, 'Appeal accepted', 'untimeout', undefined,
    );
    expect(s.member.timeout).toHaveBeenCalledWith(
      null, expect.stringContaining('case #53'),
    );
    expect(s.service.finalizeTimedAction).toHaveBeenCalledWith(
      guildId, 53, 'untimeout', 'success',
    );
  });

  it('rejects confirmations by other people, other guilds and mismatched actions', async () => {
    const s = setup();
    await previewTimeout(s);
    s.button.user.id = ownerId;
    await s.commands.onTimeoutConfirm([s.button] as any);
    s.button.user.id = actorId;
    s.button.guildId = ownerId;
    await s.commands.onTimeoutConfirm([s.button] as any);
    s.button.guildId = guildId;
    await s.commands.onUntimeoutConfirm([s.button] as any);
    expect(s.service.beginTimedAction).not.toHaveBeenCalled();
    expect(s.member.timeout).not.toHaveBeenCalled();
    expect(s.button.reply).toHaveBeenCalledTimes(3);
  });

  it('consumes timeout cancellation so later confirmation cannot act', async () => {
    const s = setup();
    await previewTimeout(s);
    await s.commands.onTimeoutCancel([s.button] as any);
    await s.commands.onTimeoutConfirm([s.button] as any);
    expect(s.button.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('canceled'),
      components: [],
    }));
    expect(s.member.timeout).not.toHaveBeenCalled();
  });

  it('allows canceling an untimeout without removing the active timeout', async () => {
    const s = setup({ currentlyTimedOut: true });
    await previewUntimeout(s);
    await s.commands.onUntimeoutCancel([s.button] as any);
    await s.commands.onUntimeoutConfirm([s.button] as any);
    expect(s.member.timeout).not.toHaveBeenCalled();
    expect(s.service.beginTimedAction).not.toHaveBeenCalled();
  });

  it('rejects confirmation once the one-minute preview expires', async () => {
    const s = setup();
    await previewTimeout(s);
    const map = (s.commands as unknown as {
      pendingTimedActions: Map<string, { confirmationExpiresAt: number }>;
    }).pendingTimedActions;
    map.get(messageId)!.confirmationExpiresAt = Date.now() - 1;
    await s.commands.onTimeoutConfirm([s.button] as any);
    expect(s.member.timeout).not.toHaveBeenCalled();
    expect(s.service.beginTimedAction).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('expired'),
    }));
  });

  it('revalidates moderator and bot permission after preview', async () => {
    for (const key of ['staff', 'bot'] as const) {
      const s = setup();
      await previewTimeout(s);
      s[key].permissions.has.mockReturnValue(false);
      await s.commands.onTimeoutConfirm([s.button] as any);
      expect(s.member.timeout).not.toHaveBeenCalled();
      expect(s.service.beginTimedAction).not.toHaveBeenCalled();
    }
  });

  it('revalidates target hierarchy or timeout state before acting', async () => {
    const s = setup();
    await previewTimeout(s);
    s.member.moderatable = false;
    await s.commands.onTimeoutConfirm([s.button] as any);
    expect(s.service.beginTimedAction).not.toHaveBeenCalled();
    expect(s.member.timeout).not.toHaveBeenCalled();
    const other = setup({ currentlyTimedOut: true });
    await previewUntimeout(other);
    other.member.communicationDisabledUntilTimestamp = Date.now() - 1000;
    await other.commands.onUntimeoutConfirm([other.button] as any);
    expect(other.service.beginTimedAction).not.toHaveBeenCalled();
  });

  it('never changes a member when the audit DB insert fails', async () => {
    const s = setup();
    await previewTimeout(s);
    (s.service.beginTimedAction as jest.Mock).mockRejectedValue(
      new Error('Database offline'),
    );
    await s.commands.onTimeoutConfirm([s.button] as any);
    expect(s.member.timeout).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('could not save'),
    }));
  });

  it('marks explicit Discord permission rejection as a failed case', async () => {
    const s = setup();
    await previewTimeout(s);
    s.member.timeout.mockRejectedValue({ status: 403, code: 50013 });
    await s.commands.onTimeoutConfirm([s.button] as any);
    expect(s.service.finalizeTimedAction).toHaveBeenCalledWith(
      guildId, 53, 'timeout', 'failed',
    );
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Discord rejected'),
    }));
  });

  it('leaves inconclusive network outcomes pending rather than retrying', async () => {
    const s = setup({ currentlyTimedOut: true });
    await previewUntimeout(s);
    s.member.timeout.mockRejectedValue(new Error('Request timed out'));
    await s.commands.onUntimeoutConfirm([s.button] as any);
    expect(s.service.finalizeTimedAction).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Verify the member timeout'),
    }));
  });

  it('reports Discord success and DB finalization failure without hiding it', async () => {
    const s = setup();
    await previewTimeout(s);
    (s.service.finalizeTimedAction as jest.Mock).mockRejectedValue(
      new Error('DB unavailable'),
    );
    await s.commands.onTimeoutConfirm([s.button] as any);
    expect(s.member.timeout).toHaveBeenCalledTimes(1);
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('remains pending'),
    }));
  });

  it('consumes a concurrent double-click exactly once', async () => {
    const s = setup();
    await previewTimeout(s);
    await Promise.all([
      s.commands.onTimeoutConfirm([s.button] as any),
      s.commands.onTimeoutConfirm([s.button] as any),
    ]);
    expect(s.service.beginTimedAction).toHaveBeenCalledTimes(1);
    expect(s.member.timeout).toHaveBeenCalledTimes(1);
  });
});
