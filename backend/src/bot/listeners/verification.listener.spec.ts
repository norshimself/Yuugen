import { VerificationListener } from './verification.listener';
import {
  answerModalId, buttonId,
} from '../../domain/verification/verification-policy';
import {
  canSafelyRemoveQuarantineRole, inspectVerificationEnvironment,
} from '../../domain/verification/verification-discord';

jest.mock('../../domain/verification/verification-discord', () => ({
  canSafelyRemoveQuarantineRole: jest.fn().mockResolvedValue(true),
  inspectVerificationEnvironment: jest.fn().mockResolvedValue({
    value: { role: {}, channel: {} }, denial: null,
  }),
}));

describe('VerificationListener: join and self-service release (#64)', () => {
  const guildId = '123456789012345678';
  const userId = '234567890123456789';
  const roleId = '345678901234567890';
  const channelId = '456789012345678901';
  const messageId = '567890123456789012';
  const token = '11111111-1111-4111-8111-111111111111';

  function setup() {
    (canSafelyRemoveQuarantineRole as jest.Mock).mockResolvedValue(true);
    (inspectVerificationEnvironment as jest.Mock).mockResolvedValue({
      value: { role: {}, channel: {} }, denial: null,
    });
    const now = Date.now();
    const held = new Set<string>();
    const member: any = {
      id: userId, joinedTimestamp: now,
      user: { id: userId, bot: false },
      roles: {
        cache: { has: (id: string) => held.has(id), keys: () => held.keys() },
        add: jest.fn(async (id: string) => { held.add(id); }),
        remove: jest.fn(async (id: string) => { held.delete(id); }),
      },
    };
    const bot = { id: '678901234567890123', permissions: {
      has: jest.fn().mockReturnValue(true),
    } };
    const guild: any = {
      id: guildId,
      members: {
        fetch: jest.fn().mockResolvedValue(member),
        fetchMe: jest.fn().mockResolvedValue(bot),
      },
    };
    member.guild = guild;
    const settings: any = {
      guildId, channelId, quarantineRoleId: roleId,
      messageId, revision: 2, status: 'active', mode: 'button',
      questionPrompt: null, answerSalt: null, answerDigest: null,
    };
    const receipt = {
      guildId, userId, sessionKey: String(now), quarantineRoleId: roleId,
      status: 'quarantined', wrongAnswers: 0,
    };
    const verification = {
      activeConfig: jest.fn().mockResolvedValue(settings),
      getSession: jest.fn().mockResolvedValue(receipt),
      claimJoin: jest.fn().mockResolvedValue(token),
      beginAction: jest.fn().mockResolvedValue(31),
      finishAction: jest.fn().mockResolvedValue(true),
      finishJoin: jest.fn().mockResolvedValue(true),
      claimRelease: jest.fn().mockResolvedValue({ token, roleId }),
      finishRelease: jest.fn().mockResolvedValue(true),
      countWrongAnswer: jest.fn().mockResolvedValue(1),
      answerMatches: jest.fn().mockReturnValue(false),
    };
    const locks = {
      acquireMember: jest.fn().mockResolvedValue({ token, coolingDown: false }),
      hasMemberLease: jest.fn().mockResolvedValue(true),
      releaseMember: jest.fn().mockResolvedValue(undefined),
    };
    const config = { get: jest.fn().mockReturnValue('true') };
    const interaction: any = {
      id: '789012345678901234',
      isButton: () => true, isModalSubmit: () => false,
      customId: buttonId(guildId, 2),
      guildId, guild, channelId,
      message: { id: messageId },
      user: { id: userId },
      reply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
      deferReply: jest.fn().mockResolvedValue({}),
      showModal: jest.fn().mockResolvedValue({}),
      fields: { getTextInputValue: jest.fn().mockReturnValue('secret-answer') },
      deferred: false, replied: false,
    };
    return {
      now, guild, member, bot, held, settings, receipt,
      verification, locks, config, interaction,
      listener: new VerificationListener(verification as any, locks as any, config as any),
    };
  }

  it('does not quarantine with Guild Members intent off', async () => {
    const x = setup();
    x.config.get.mockReturnValue('false');
    await x.listener.onGuildMemberAdd(x.member);
    expect(x.verification.activeConfig).not.toHaveBeenCalled();
    expect(x.member.roles.add).not.toHaveBeenCalled();
  });

  it('ignores bot joins, stale joins and unknown timestamps', async () => {
    const x = setup();
    x.member.user.bot = true;
    await x.listener.onGuildMemberAdd(x.member);
    x.member.user.bot = false;
    x.member.joinedTimestamp = Date.now() - 121000;
    await x.listener.onGuildMemberAdd(x.member);
    x.member.joinedTimestamp = null;
    await x.listener.onGuildMemberAdd(x.member);
    expect(x.verification.claimJoin).not.toHaveBeenCalled();
  });

  it('quarantines a newly joined member after a DB session and audit claim', async () => {
    const x = setup();
    await x.listener.onGuildMemberAdd(x.member);
    expect(x.verification.claimJoin).toHaveBeenCalledWith(
      guildId, userId, String(x.now), roleId,
    );
    expect(x.verification.beginAction).toHaveBeenCalledWith(
      guildId, 'join:' + userId + ':' + x.now,
      userId, userId, String(x.now), 'join',
    );
    expect(x.member.roles.add).toHaveBeenCalledWith(
      roleId, 'Yuugen verification quarantine for new join',
    );
    expect(x.verification.finishJoin).toHaveBeenCalledWith(
      guildId, userId, String(x.now), token, 'quarantined',
    );
    expect(x.verification.finishAction).toHaveBeenCalledWith(
      guildId, 31, 'succeeded',
    );
  });

  it('deduplicates gateway join delivery before any Discord mutation', async () => {
    const x = setup();
    x.verification.claimJoin.mockResolvedValue(null);
    await x.listener.onGuildMemberAdd(x.member);
    expect(x.member.roles.add).not.toHaveBeenCalled();
    expect(x.verification.beginAction).not.toHaveBeenCalled();
  });

  it('does not apply quarantine to a stale membership session', async () => {
    const x = setup();
    x.guild.members.fetch.mockResolvedValue({
      ...x.member, joinedTimestamp: x.now + 30000,
    });
    await x.listener.onGuildMemberAdd(x.member);
    expect(x.verification.claimJoin).not.toHaveBeenCalled();
  });

  it('does not retry or mutate if the DB audit could not be persisted', async () => {
    const x = setup();
    x.verification.beginAction.mockRejectedValueOnce(new Error('Database offline'));
    await x.listener.onGuildMemberAdd(x.member);
    expect(x.member.roles.add).not.toHaveBeenCalled();
    expect(x.verification.finishJoin).toHaveBeenCalledWith(
      guildId, userId, String(x.now), token, 'join_uncertain',
    );
  });

  it('refuses any extra role that could bypass the quarantine', async () => {
    const x = setup();
    x.held.add('890123456789012345');
    await x.listener.onGuildMemberAdd(x.member);
    expect(x.member.roles.add).not.toHaveBeenCalled();
    expect(x.verification.finishJoin).toHaveBeenCalledWith(
      guildId, userId, String(x.now), token, 'join_failed',
    );
  });

  it('denies role changes when channel isolation becomes unsafe after publication', async () => {
    const x = setup();
    (inspectVerificationEnvironment as jest.Mock).mockResolvedValueOnce({
      denial: 'unverified members can see other channels', value: null,
    });
    await x.listener.onGuildMemberAdd(x.member);
    expect(x.member.roles.add).not.toHaveBeenCalled();
    expect(x.verification.finishAction).toHaveBeenCalledWith(
      guildId, 31, 'denied',
    );
  });

  it('records confirmed Discord permission failures without a blind retry', async () => {
    const x = setup();
    x.member.roles.add.mockRejectedValueOnce({ code: 50013 });
    await x.listener.onGuildMemberAdd(x.member);
    expect(x.member.roles.add).toHaveBeenCalledTimes(1);
    expect(x.verification.finishJoin).toHaveBeenCalledWith(
      guildId, userId, String(x.now), token, 'join_failed',
    );
    expect(x.verification.finishAction).toHaveBeenCalledWith(
      guildId, 31, 'failed',
    );
  });

  it('keeps uncertain role-add responses pending for staff review', async () => {
    const x = setup();
    x.member.roles.add.mockRejectedValueOnce(new Error('network timeout'));
    await x.listener.onGuildMemberAdd(x.member);
    expect(x.member.roles.add).toHaveBeenCalledTimes(1);
    expect(x.verification.finishJoin).toHaveBeenCalledWith(
      guildId, userId, String(x.now), token, 'join_uncertain',
    );
    expect(x.verification.finishAction).toHaveBeenCalledWith(
      guildId, 31, 'uncertain',
    );
  });

  it('refuses copied button controls from another message or channel', async () => {
    const x = setup();
    x.interaction.message.id = '999999999999999999';
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.locks.acquireMember).not.toHaveBeenCalled();
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    const y = setup();
    y.interaction.channelId = '999999999999999999';
    await y.listener.onInteraction([y.interaction] as any);
    expect(y.member.roles.remove).not.toHaveBeenCalled();
  });

  it('refuses buttons from disabled configs, wrong guilds and stale revisions', async () => {
    const x = setup();
    x.verification.activeConfig.mockResolvedValue(null);
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    const y = setup();
    y.interaction.customId = buttonId(guildId, 3);
    await y.listener.onInteraction([y.interaction] as any);
    expect(y.locks.acquireMember).not.toHaveBeenCalled();
    const z = setup();
    z.interaction.guildId = '999999999999999999';
    await z.listener.onInteraction([z.interaction] as any);
    expect(z.locks.acquireMember).not.toHaveBeenCalled();
  });

  it('denies self-verification without a confirmed quarantine receipt and role', async () => {
    const x = setup();
    x.held.add(roleId);
    x.verification.getSession.mockResolvedValue({
      ...x.receipt, status: 'join_uncertain',
    });
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    const y = setup();
    y.verification.getSession.mockResolvedValue({
      ...y.receipt, wrongAnswers: 5,
    });
    await y.listener.onInteraction([y.interaction] as any);
    expect(y.member.roles.remove).not.toHaveBeenCalled();
    const z = setup();
    z.verification.getSession.mockResolvedValue(null);
    await z.listener.onInteraction([z.interaction] as any);
    expect(z.member.roles.remove).not.toHaveBeenCalled();
  });

  it('removes only the one quarantine role after a valid button acceptance', async () => {
    const x = setup();
    x.held.add(roleId);
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.verification.beginAction).toHaveBeenCalledWith(
      guildId, x.interaction.id, userId, userId, String(x.now), 'verify',
    );
    expect(x.member.roles.remove).toHaveBeenCalledWith(
      roleId, 'Yuugen confirmed member verification',
    );
    expect(x.verification.finishRelease).toHaveBeenCalledWith(
      guildId, userId, String(x.now), token, 'released',
    );
    expect(x.verification.finishAction).toHaveBeenCalledWith(
      guildId, 31, 'succeeded',
    );
    expect(x.member.roles.add).not.toHaveBeenCalled();
  });

  it('uses the modal when question mode is selected and sends no role action yet', async () => {
    const x = setup();
    x.held.add(roleId);
    x.settings.mode = 'question';
    x.settings.questionPrompt = 'What is the keyword?';
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.interaction.showModal).toHaveBeenCalledTimes(1);
    expect(x.verification.beginAction).not.toHaveBeenCalled();
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    const modal = x.interaction.showModal.mock.calls[0][0].toJSON();
    expect(modal.custom_id).toBe(answerModalId(guildId, 2, String(x.now)));
  });

  it('records wrong answers only as metadata and caps attempts at five', async () => {
    const x = setup();
    x.held.add(roleId);
    x.settings.mode = 'question';
    x.interaction.isButton = () => false;
    x.interaction.isModalSubmit = () => true;
    x.interaction.customId = answerModalId(guildId, 2, String(x.now));
    x.interaction.fields.getTextInputValue.mockReturnValue('PRIVATE ANSWER VALUE');
    x.verification.answerMatches.mockReturnValue(false);
    x.verification.countWrongAnswer.mockResolvedValueOnce(5);
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.verification.beginAction).toHaveBeenCalledWith(
      guildId, x.interaction.id, userId, userId,
      String(x.now), 'wrong_answer',
    );
    expect(x.verification.countWrongAnswer).toHaveBeenCalledWith(
      guildId, userId, String(x.now),
    );
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    expect(JSON.stringify(x.verification.beginAction.mock.calls))
      .not.toContain('PRIVATE ANSWER VALUE');
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('contact staff'),
    );
  });

  it('rejects an old modal after a member leaves and rejoins', async () => {
    const x = setup();
    x.held.add(roleId);
    x.settings.mode = 'question';
    x.interaction.isButton = () => false;
    x.interaction.isModalSubmit = () => true;
    x.interaction.customId = answerModalId(guildId, 2, String(x.now - 60000));
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.verification.beginAction).not.toHaveBeenCalled();
    expect(x.member.roles.remove).not.toHaveBeenCalled();
  });

  it('releases quarantine after a correct modal answer', async () => {
    const x = setup();
    x.held.add(roleId);
    x.settings.mode = 'question';
    x.interaction.isButton = () => false;
    x.interaction.isModalSubmit = () => true;
    x.interaction.customId = answerModalId(guildId, 2, String(x.now));
    x.verification.answerMatches.mockReturnValue(true);
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.verification.beginAction).toHaveBeenCalledWith(
      guildId, x.interaction.id, userId, userId,
      String(x.now), 'verify',
    );
    expect(x.member.roles.remove).toHaveBeenCalledTimes(1);
  });

  it('deduplicates repeated interactions without removing a role twice', async () => {
    const x = setup();
    x.held.add(roleId);
    x.verification.beginAction.mockResolvedValue(null);
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    expect(x.verification.claimRelease).not.toHaveBeenCalled();
  });

  it('respects a member lock already held by another role operation', async () => {
    const x = setup();
    x.held.add(roleId);
    x.locks.acquireMember.mockResolvedValue(null);
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    expect(x.verification.beginAction).not.toHaveBeenCalled();
  });

  it('blocks if staff disables verification before role removal', async () => {
    const x = setup();
    x.held.add(roleId);
    x.verification.activeConfig
      .mockResolvedValueOnce(x.settings)
      .mockResolvedValueOnce(x.settings)
      .mockResolvedValueOnce(null);
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    expect(x.verification.finishRelease).toHaveBeenCalledWith(
      guildId, userId, String(x.now), token, 'quarantined',
    );
  });

  it('requires bot hierarchy and a live member lease before removing', async () => {
    const x = setup();
    x.held.add(roleId);
    (canSafelyRemoveQuarantineRole as jest.Mock).mockResolvedValueOnce(false);
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    const y = setup();
    y.held.add(roleId);
    y.locks.hasMemberLease.mockResolvedValue(false);
    await y.listener.onInteraction([y.interaction] as any);
    expect(y.member.roles.remove).not.toHaveBeenCalled();
  });

  it('preserves release_uncertain status after a Discord network timeout', async () => {
    const x = setup();
    x.held.add(roleId);
    x.member.roles.remove.mockRejectedValueOnce(new Error('unknown network response'));
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.member.roles.remove).toHaveBeenCalledTimes(1);
    expect(x.verification.finishRelease).toHaveBeenCalledWith(
      guildId, userId, String(x.now), token, 'release_uncertain',
    );
    expect(x.verification.finishAction).toHaveBeenCalledWith(
      guildId, 31, 'uncertain',
    );
  });

  it('treats an unverified REST role result as uncertain rather than verified', async () => {
    const x = setup();
    x.held.add(roleId);
    x.member.roles.remove.mockResolvedValueOnce(undefined); // does not actually remove
    await x.listener.onInteraction([x.interaction] as any);
    expect(x.verification.finishRelease).toHaveBeenCalledWith(
      guildId, userId, String(x.now), token, 'release_uncertain',
    );
    expect(x.verification.finishAction).toHaveBeenCalledWith(
      guildId, 31, 'uncertain',
    );
  });
});
