import { PermissionFlagsBits, User } from 'discord.js';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { ModerationCommands } from './moderation.command';

describe('Moderation permanent ban interactions', () => {
  const guildId = '123456789012345678';
  const actorId = '234567890123456789';
  const targetId = '345678901234567890';
  const ownerId = '456789012345678901';
  const messageId = '567890123456789012';

  function setup(options: {
    actorCanBan?: boolean;
    actorAbove?: boolean;
    botCanBan?: boolean;
    bannable?: boolean;
    targetBot?: boolean;
    targetPresent?: boolean;
  } = {}) {
    const staff = {
      permissions: {
        has: jest.fn().mockReturnValue(options.actorCanBan !== false),
      },
      roles: {
        highest: {
          comparePositionTo: jest.fn().mockReturnValue(
            options.actorAbove === false ? 0 : 1,
          ),
        },
      },
    };
    const member = {
      user: { bot: options.targetBot === true },
      bannable: options.bannable !== false,
      roles: { highest: {} },
      ban: jest.fn().mockResolvedValue(undefined),
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
          user === actorId
            ? staff
            : user === targetId && options.targetPresent !== false
              ? member
              : null,
        ),
        fetchMe: jest.fn().mockResolvedValue(bot),
      },
    };
    const slash = {
      guild,
      guildId,
      user: { id: actorId },
      deferReply: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue({ id: messageId }),
    };
    const button = {
      guild,
      guildId,
      user: { id: actorId },
      message: { id: messageId },
      reply: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
    };
    const service = {
      beginBan: jest.fn().mockResolvedValue({ id: 90 }),
      finalizeBan: jest.fn().mockResolvedValue({ id: 90, action: 'ban' }),
      casesForUser: jest.fn().mockResolvedValue([]),
    } as unknown as ModerationService;
    const user = { id: targetId, bot: false } as User;
    return {
      commands: new ModerationCommands(service),
      slash,
      button,
      guild,
      staff,
      member,
      bot,
      user,
      service,
    };
  }

  it('shows a private confirmation without touching Discord or writing a case', async () => {
    const { commands, slash, member, user, service } = setup();
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    expect(member.ban).not.toHaveBeenCalled();
    expect(service.beginBan).not.toHaveBeenCalled();
    expect(slash.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Confirm permanent ban'),
      components: expect.any(Array),
      allowedMentions: { parse: [] },
    }));
  });

  it('rejects moderators without Ban Members permission', async () => {
    const { commands, slash, member, user, service } =
      setup({ actorCanBan: false });
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    expect(slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Ban Members'),
    );
    expect(member.ban).not.toHaveBeenCalled();
    expect(service.beginBan).not.toHaveBeenCalled();
  });

  it('rejects missing bot permission and prohibited role hierarchy', async () => {
    for (const options of [{ botCanBan: false }, { bannable: false }, { actorAbove: false }]) {
      const { commands, slash, user, member, service } = setup(options);
      await commands.onBan([slash] as any, { user, reason: 'Spam' });
      expect(member.ban).not.toHaveBeenCalled();
      expect(service.beginBan).not.toHaveBeenCalled();
    }
  });

  it('does not ban bots or members that cannot be fetched', async () => {
    for (const options of [{ targetBot: true }, { targetPresent: false }]) {
      const { commands, slash, user, member, service } = setup(options);
      await commands.onBan([slash] as any, { user, reason: 'Spam' });
      expect(member.ban).not.toHaveBeenCalled();
      expect(service.beginBan).not.toHaveBeenCalled();
    }
  });

  it('validates the supplied reason before prompting', async () => {
    const { commands, slash, user, service } = setup();
    await commands.onBan([slash] as any, { user, reason: '' });
    expect(slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('1 and 512'),
    );
    expect(service.beginBan).not.toHaveBeenCalled();
  });

  it('writes a pending case first, bans without deleting messages, then finalizes', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onBan([slash] as any, { user, reason: 'Repeated spam' });
    await commands.onBanConfirm([button] as any);

    expect(service.beginBan).toHaveBeenCalledWith(
      guildId, targetId, actorId, 'Repeated spam',
    );
    expect(member.ban).toHaveBeenCalledWith({
      deleteMessageSeconds: 0,
      reason: expect.stringContaining('case #90'),
    });
    expect(service.finalizeBan).toHaveBeenCalledWith(guildId, 90, 'ban');
    expect((service.beginBan as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(member.ban.mock.invocationCallOrder[0]);
    expect(member.ban.mock.invocationCallOrder[0])
      .toBeLessThan((service.finalizeBan as jest.Mock).mock.invocationCallOrder[0]);
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Permanently banned'),
      allowedMentions: { parse: [] },
      components: [],
    }));
  });

  it('does not allow another user or guild to confirm', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    button.user.id = ownerId;
    await commands.onBanConfirm([button] as any);
    button.user.id = actorId;
    button.guildId = ownerId;
    await commands.onBanConfirm([button] as any);
    expect(member.ban).not.toHaveBeenCalled();
    expect(service.beginBan).not.toHaveBeenCalled();
    expect(button.reply).toHaveBeenCalledTimes(2);
  });

  it('lets the original moderator cancel the confirmation', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    await commands.onBanCancel([button] as any);
    expect(button.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('canceled'),
      components: [],
    }));
    await commands.onBanConfirm([button] as any);
    expect(member.ban).not.toHaveBeenCalled();
    expect(service.beginBan).not.toHaveBeenCalled();
  });

  it('rejects confirmations after 60 seconds', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    const pending = (commands as unknown as {
      pendingBans: Map<string, { expiresAt: number }>;
    }).pendingBans;
    pending.get(messageId)!.expiresAt = Date.now() - 1;
    await commands.onBanConfirm([button] as any);
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('expired'),
    }));
    expect(member.ban).not.toHaveBeenCalled();
    expect(service.beginBan).not.toHaveBeenCalled();
  });

  it('rechecks moderator permission on confirmation', async () => {
    const { commands, slash, button, member, staff, service, user } = setup();
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    staff.permissions.has.mockReturnValue(false);
    await commands.onBanConfirm([button] as any);
    expect(member.ban).not.toHaveBeenCalled();
    expect(service.beginBan).not.toHaveBeenCalled();
  });

  it('rechecks the bot permissions and member hierarchy on confirmation', async () => {
    const { commands, slash, button, member, bot, service, user } = setup();
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    bot.permissions.has.mockReturnValue(false);
    member.bannable = false;
    await commands.onBanConfirm([button] as any);
    expect(member.ban).not.toHaveBeenCalled();
    expect(service.beginBan).not.toHaveBeenCalled();
  });

  it('never calls Discord if saving the audit attempt fails', async () => {
    const { commands, slash, button, member, service, user } = setup();
    (service.beginBan as jest.Mock).mockRejectedValue(new Error('Database unavailable'));
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    await commands.onBanConfirm([button] as any);
    expect(member.ban).not.toHaveBeenCalled();
    expect(service.finalizeBan).not.toHaveBeenCalled();
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('No ban attempted'),
    }));
  });

  it('marks explicit Discord 403 rejections as failed', async () => {
    const { commands, slash, button, member, service, user } = setup();
    member.ban.mockRejectedValue({ status: 403 });
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    await commands.onBanConfirm([button] as any);
    expect(service.finalizeBan).toHaveBeenCalledWith(guildId, 90, 'ban_failed');
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Discord rejected'),
    }));
  });

  it('keeps ambiguous Discord failures pending for staff reconciliation', async () => {
    const { commands, slash, button, member, service, user } = setup();
    member.ban.mockRejectedValue(new Error('Connection timeout'));
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    await commands.onBanConfirm([button] as any);
    expect(service.finalizeBan).not.toHaveBeenCalled();
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Check the Discord guild ban list'),
    }));
  });

  it('reports an already completed ban when finalization fails', async () => {
    const { commands, slash, button, member, service, user } = setup();
    (service.finalizeBan as jest.Mock).mockRejectedValue(new Error('Database unavailable'));
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    await commands.onBanConfirm([button] as any);
    expect(member.ban).toHaveBeenCalledTimes(1);
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('remains pending'),
    }));
  });

  it('allows only one of two simultaneous confirmation clicks to ban', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onBan([slash] as any, { user, reason: 'Spam' });
    await Promise.all([
      commands.onBanConfirm([button] as any),
      commands.onBanConfirm([button] as any),
    ]);
    expect(service.beginBan).toHaveBeenCalledTimes(1);
    expect(member.ban).toHaveBeenCalledTimes(1);
  });

  it('allows ban staff to view cases even without Moderate Members permission', async () => {
    const { commands, slash, staff, service, user } = setup();
    staff.permissions.has.mockImplementation(
      (perm: bigint) => perm === PermissionFlagsBits.BanMembers,
    );
    await commands.onCases([slash] as any, { user });
    expect(service.casesForUser).toHaveBeenCalledWith(guildId, targetId);
  });
});
