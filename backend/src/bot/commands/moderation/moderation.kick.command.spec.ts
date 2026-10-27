import { PermissionFlagsBits, User } from 'discord.js';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { ModerationCommands } from './moderation.command';

describe('Moderation kick command', () => {
  const guildId = '123456789012345678';
  const staffId = '234567890123456789';
  const targetId = '345678901234567890';
  const ownerId = '456789012345678901';
  const messageId = '567890123456789012';

  function setup(options: {
    actorCanKick?: boolean;
    actorAbove?: boolean;
    botCanKick?: boolean;
    targetKickable?: boolean;
    targetIsBot?: boolean;
    targetPresent?: boolean;
  } = {}) {
    const staff = {
      permissions: {
        has: jest.fn().mockReturnValue(options.actorCanKick !== false),
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
      user: { bot: options.targetIsBot === true },
      kickable: options.targetKickable !== false,
      roles: { highest: {} },
      kick: jest.fn().mockResolvedValue(undefined),
    };
    const bot = {
      permissions: {
        has: jest.fn().mockReturnValue(options.botCanKick !== false),
      },
    };
    const guild = {
      id: guildId,
      ownerId,
      members: {
        fetch: jest.fn(async ({ user }: { user: string }) =>
          user === staffId
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
      beginKick: jest.fn().mockResolvedValue({ id: 42 }),
      finalizeKick: jest.fn().mockResolvedValue({ id: 42, action: 'kick' }),
      casesForUser: jest.fn().mockResolvedValue([]),
    } as unknown as ModerationService;
    const user = { id: targetId, bot: false } as User;
    return {
      commands: new ModerationCommands(service),
      slash,
      button,
      member,
      bot,
      staff,
      guild,
      service,
      user,
    };
  }

  it('previews a kick without kicking or creating a case', async () => {
    const { commands, slash, member, service, user } = setup();
    await commands.onKick([slash] as any, { user, reason: 'A test reason' });
    expect(member.kick).not.toHaveBeenCalled();
    expect(service.beginKick).not.toHaveBeenCalled();
    expect(slash.editReply).toHaveBeenCalledWith(expect.objectContaining({
      allowedMentions: { parse: [] },
      content: expect.stringContaining('Confirm kick'),
      components: expect.any(Array),
    }));
  });

  it('denies moderators without Kick Members', async () => {
    const { commands, slash, member, service, user } =
      setup({ actorCanKick: false });
    await commands.onKick([slash] as any, { user, reason: 'A test reason' });
    expect(slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Kick Members'),
    );
    expect(member.kick).not.toHaveBeenCalled();
    expect(service.beginKick).not.toHaveBeenCalled();
  });

  it('denies the action when Yuugen lacks Kick Members or role hierarchy', async () => {
    const { commands, slash, member, service, user } =
      setup({ botCanKick: false });
    await commands.onKick([slash] as any, { user, reason: 'A test reason' });
    expect(slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Yuugen needs'),
    );
    expect(member.kick).not.toHaveBeenCalled();
    expect(service.beginKick).not.toHaveBeenCalled();
  });

  it('requires a separate confirmation and records success after the kick', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    await commands.onKickConfirm([button] as any);
    expect(service.beginKick).toHaveBeenCalledWith(
      guildId, targetId, staffId, 'Spam',
    );
    expect(member.kick).toHaveBeenCalledWith(
      expect.stringContaining('case #42'),
    );
    expect(service.finalizeKick).toHaveBeenCalledWith(guildId, 42, 'kick');
    expect((service.beginKick as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(member.kick.mock.invocationCallOrder[0]);
    expect(member.kick.mock.invocationCallOrder[0])
      .toBeLessThan((service.finalizeKick as jest.Mock).mock.invocationCallOrder[0]);
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Kicked'),
      components: [],
      allowedMentions: { parse: [] },
    }));
  });

  it('does not allow another user or guild to confirm', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    button.user.id = ownerId;
    await commands.onKickConfirm([button] as any);
    expect(button.reply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('not yours'),
    }));
    expect(service.beginKick).not.toHaveBeenCalled();
    expect(member.kick).not.toHaveBeenCalled();
    button.user.id = staffId;
    button.guildId = ownerId;
    await commands.onKickConfirm([button] as any);
    expect(service.beginKick).not.toHaveBeenCalled();
  });

  it('cancel consumes the prompt and blocks a later confirmation', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    await commands.onKickCancel([button] as any);
    expect(button.update).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('canceled'),
      components: [],
    }));
    await commands.onKickConfirm([button] as any);
    expect(member.kick).not.toHaveBeenCalled();
    expect(service.beginKick).not.toHaveBeenCalled();
  });

  it('expires confirmation after one minute', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    const map = (commands as unknown as {
      pendingKicks: Map<string, { expiresAt: number }>;
    }).pendingKicks;
    map.get(messageId)!.expiresAt = Date.now() - 1;
    await commands.onKickConfirm([button] as any);
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('expired'),
    }));
    expect(member.kick).not.toHaveBeenCalled();
    expect(service.beginKick).not.toHaveBeenCalled();
  });

  it('rechecks moderator rights after confirmation', async () => {
    const { commands, slash, button, staff, member, service, user } = setup();
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    staff.permissions.has.mockReturnValue(false);
    await commands.onKickConfirm([button] as any);
    expect(member.kick).not.toHaveBeenCalled();
    expect(service.beginKick).not.toHaveBeenCalled();
  });

  it('rechecks target kickability after confirmation', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    member.kickable = false;
    await commands.onKickConfirm([button] as any);
    expect(service.beginKick).not.toHaveBeenCalled();
    expect(member.kick).not.toHaveBeenCalled();
  });

  it('never contacts Discord when the audit database cannot save the case', async () => {
    const { commands, slash, button, member, service, user } = setup();
    (service.beginKick as jest.Mock).mockRejectedValue(new Error('DB offline'));
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    await commands.onKickConfirm([button] as any);
    expect(member.kick).not.toHaveBeenCalled();
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('No kick attempted'),
    }));
  });

  it('marks explicit Discord permission rejection as a failed case', async () => {
    const { commands, slash, button, member, service, user } = setup();
    member.kick.mockRejectedValue({ status: 403 });
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    await commands.onKickConfirm([button] as any);
    expect(service.finalizeKick).toHaveBeenCalledWith(
      guildId, 42, 'kick_failed',
    );
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Discord rejected'),
    }));
  });

  it('leaves transport-ambiguous outcomes pending for manual reconciliation', async () => {
    const { commands, slash, button, member, service, user } = setup();
    member.kick.mockRejectedValue(new Error('Connection timeout'));
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    await commands.onKickConfirm([button] as any);
    expect(service.finalizeKick).not.toHaveBeenCalled();
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('unconfirmed'),
    }));
  });

  it('reports success with an unresolved audit case accurately', async () => {
    const { commands, slash, button, service, user } = setup();
    (service.finalizeKick as jest.Mock).mockRejectedValue(new Error('DB offline'));
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    await commands.onKickConfirm([button] as any);
    expect(button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('still pending'),
    }));
  });

  it('allows only one confirmation to consume a kick', async () => {
    const { commands, slash, button, member, service, user } = setup();
    await commands.onKick([slash] as any, { user, reason: 'Spam' });
    await Promise.all([
      commands.onKickConfirm([button] as any),
      commands.onKickConfirm([button] as any),
    ]);
    expect(service.beginKick).toHaveBeenCalledTimes(1);
    expect(member.kick).toHaveBeenCalledTimes(1);
  });

  it('keeps case history permissioned and guild-specific', async () => {
    const { commands, slash, service, user } = setup();
    await commands.onCases([slash] as any, { user });
    expect(service.casesForUser).toHaveBeenCalledWith(guildId, targetId);
    expect(slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('No moderation cases'),
    );
  });

  it('does not expose case history to users without moderation permission', async () => {
    const { commands, slash, service, user } = setup({
      actorCanKick: false,
    });
    await commands.onCases([slash] as any, { user });
    expect(service.casesForUser).not.toHaveBeenCalled();
  });
});
