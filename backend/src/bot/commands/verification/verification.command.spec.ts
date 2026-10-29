import { ChannelType } from 'discord.js';
import { VerificationCommands } from './verification.command';
import { inspectVerificationEnvironment, canSafelyRemoveQuarantineRole } from
  '../../../domain/verification/verification-discord';

jest.mock('../../../domain/verification/verification-discord', () => ({
  inspectVerificationEnvironment: jest.fn(),
  canSafelyRemoveQuarantineRole: jest.fn(),
}));

describe('/verify staff setup, publish and override (#64)', () => {
  const guildId = '123456789012345678';
  const actorId = '234567890123456789';
  const targetId = '345678901234567890';
  const roleId = '456789012345678901';
  const channelId = '567890123456789012';
  const messageId = '678901234567890123';
  const token = '11111111-1111-4111-8111-111111111111';

  function setup() {
    const roles = new Set([roleId]);
    const role: any = { id: roleId, managed: false,
      permissions: { bitfield: 0n } };
    const message = {
      id: messageId, edit: jest.fn().mockResolvedValue(undefined),
    };
    const channel = {
      id: channelId, guildId,
      type: ChannelType.GuildText,
      messages: { fetch: jest.fn().mockResolvedValue(message) },
      send: jest.fn().mockResolvedValue(message),
    };
    const staff = {
      id: actorId, permissions: { has: jest.fn().mockReturnValue(true) },
      roles: { highest: { comparePositionTo: jest.fn().mockReturnValue(1) } },
    };
    const bot = {
      id: '789012345678901234',
      permissions: { has: jest.fn().mockReturnValue(true) },
      roles: { highest: { comparePositionTo: jest.fn().mockReturnValue(1) } },
    };
    const member: any = {
      id: targetId, joinedTimestamp: Date.now(),
      user: { id: targetId, bot: false },
      roles: {
        cache: { has: (id: string) => roles.has(id) },
        remove: jest.fn(async (id: string) => { roles.delete(id); }),
        add: jest.fn(),
      },
    };
    const guild: any = {
      id: guildId, ownerId: '999999999999999999',
      members: {
        fetch: jest.fn(async ({ user }: { user: string }) =>
          user === actorId ? staff : member),
        fetchMe: jest.fn().mockResolvedValue(bot),
      },
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
      roles: { fetch: jest.fn().mockResolvedValue(role) },
    };
    role.guild = guild;
    (inspectVerificationEnvironment as jest.Mock).mockResolvedValue({
      value: { channel, role }, denial: null,
    });
    (canSafelyRemoveQuarantineRole as jest.Mock).mockResolvedValue(true);
    const stored = {
      guildId, channelId, quarantineRoleId: roleId,
      messageId, revision: 2, mode: 'button', status: 'draft',
      answerDigest: null, answerSalt: null,
    };
    const verification = {
      getConfig: jest.fn().mockResolvedValue(stored),
      recentActions: jest.fn().mockResolvedValue([]),
      setup: jest.fn().mockResolvedValue(stored),
      beginPublish: jest.fn().mockResolvedValue({ ...stored, status: 'publishing' }),
      activate: jest.fn().mockResolvedValue(true),
      disable: jest.fn().mockResolvedValue({ ...stored, status: 'disabled' }),
      getSession: jest.fn().mockResolvedValue({
        guildId, userId: targetId, sessionKey: String(member.joinedTimestamp),
        quarantineRoleId: roleId, status: 'quarantined',
      }),
      prepareOverride: jest.fn().mockResolvedValue(undefined),
      beginAction: jest.fn().mockResolvedValue(27),
      finishAction: jest.fn().mockResolvedValue(true),
      claimRelease: jest.fn().mockResolvedValue({ token, roleId }),
      finishRelease: jest.fn().mockResolvedValue(true),
    };
    const locks = {
      acquireMember: jest.fn().mockResolvedValue({ token, coolingDown: false }),
      hasMemberLease: jest.fn().mockResolvedValue(true),
      releaseMember: jest.fn().mockResolvedValue(undefined),
    };
    const config = { get: jest.fn().mockReturnValue('true') };
    const interaction: any = {
      id: '890123456789012345', guild, guildId, user: { id: actorId },
      deferReply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
    };
    return {
      roles, role, message, channel, member, staff, bot, guild,
      verification, locks, config, interaction,
      command: new VerificationCommands(
        verification as any, locks as any, config as any,
      ),
    };
  }

  it('requires current ManageGuild and ManageRoles permissions for setup', async () => {
    const x = setup();
    x.staff.permissions.has.mockReturnValue(false);
    await x.command.onSetup([x.interaction] as any, {
      channel: x.channel as any, quarantineRole: x.role as any,
      mode: 'button',
    });
    expect(x.verification.setup).not.toHaveBeenCalled();
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Manage Server'),
    );
  });

  it('rejects configuration without Guild Members gateway intent', async () => {
    const x = setup();
    x.config.get.mockReturnValue('false');
    await x.command.onSetup([x.interaction] as any, {
      channel: x.channel as any, quarantineRole: x.role as any,
      mode: 'button',
    });
    expect(x.verification.setup).not.toHaveBeenCalled();
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Guild Members'),
    );
  });

  it('prevents cross-guild setup and requires manager hierarchy above role', async () => {
    const x = setup();
    await x.command.onSetup([x.interaction] as any, {
      channel: { ...x.channel, guildId: '999999999999999999' } as any,
      quarantineRole: x.role as any, mode: 'button',
    });
    expect(x.verification.setup).not.toHaveBeenCalled();
    x.staff.roles.highest.comparePositionTo.mockReturnValue(0);
    await x.command.onSetup([x.interaction] as any, {
      channel: x.channel as any, quarantineRole: x.role as any,
      mode: 'button',
    });
    expect(x.verification.setup).not.toHaveBeenCalled();
  });

  it('creates an unpublished draft and never sends during setup', async () => {
    const x = setup();
    await x.command.onSetup([x.interaction] as any, {
      channel: x.channel as any, quarantineRole: x.role as any,
      mode: 'question', question: 'What is the keyword?', answer: 'PRIVATE',
    });
    expect(x.verification.setup).toHaveBeenCalledWith(
      guildId, channelId, roleId, actorId,
      'question', 'What is the keyword?', 'PRIVATE',
    );
    expect(x.channel.send).not.toHaveBeenCalled();
    expect(x.interaction.editReply).not.toHaveBeenCalledWith(
      expect.stringContaining('PRIVATE'),
    );
  });

  it('rejects a quarantine role that opens another channel or raises privileges', async () => {
    const x = setup();
    (inspectVerificationEnvironment as jest.Mock).mockResolvedValueOnce({
      value: null, denial: 'Quarantine role must not grant access beyond verification.',
    });
    await x.command.onSetup([x.interaction] as any, {
      channel: x.channel as any, quarantineRole: x.role as any,
      mode: 'button',
    });
    expect(x.verification.setup).not.toHaveBeenCalled();
  });

  it('publishes one button only after DB reservation and role safety check', async () => {
    const x = setup();
    await x.command.onPublish([x.interaction] as any);
    expect(x.verification.beginPublish).toHaveBeenCalledWith(guildId);
    expect(x.channel.send).toHaveBeenCalledTimes(1);
    expect(x.channel.send).toHaveBeenCalledWith(expect.objectContaining({
      allowedMentions: { parse: [] },
      components: expect.arrayContaining([expect.anything()]),
    }));
    expect(x.verification.activate).toHaveBeenCalledWith(
      guildId, 2, messageId,
    );
  });

  it('leaves uncertain Discord publishes inert without retrying', async () => {
    const x = setup();
    x.channel.send.mockRejectedValueOnce(new Error('Unknown send status'));
    await x.command.onPublish([x.interaction] as any);
    expect(x.channel.send).toHaveBeenCalledTimes(1);
    expect(x.verification.activate).not.toHaveBeenCalled();
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('unknown'),
    );
  });

  it('disables the DB configuration before best-effort component removal', async () => {
    const x = setup();
    await x.command.onDisable([x.interaction] as any);
    expect(x.verification.disable).toHaveBeenCalledWith(guildId);
    expect(x.channel.messages.fetch).toHaveBeenCalledWith(messageId);
    expect(x.message.edit).toHaveBeenCalledWith({ components: [] });
    expect(x.member.roles.remove).not.toHaveBeenCalled();
  });

  it('allows safe disable even if the old destination channel disappeared', async () => {
    const x = setup();
    x.guild.channels.fetch.mockResolvedValue(null);
    await x.command.onDisable([x.interaction] as any);
    expect(x.verification.disable).toHaveBeenCalled();
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('disabled'),
    );
  });

  it('shows metadata-only status, not the salted answer or prompt', async () => {
    const x = setup();
    await x.command.onStatus([x.interaction] as any);
    expect(x.verification.recentActions).toHaveBeenCalledWith(guildId);
    const result = x.interaction.editReply.mock.calls[0][0];
    expect(result.content).toContain('Verification: draft');
    expect(result.content).not.toContain('answerDigest');
    expect(result.allowedMentions).toEqual({ parse: [] });
  });

  it('releases a single quarantine role only after staff override audit', async () => {
    const x = setup();
    await x.command.onOverride([x.interaction] as any, {
      member: { id: targetId } as any,
    });
    expect(x.verification.prepareOverride).toHaveBeenCalledWith(
      guildId, targetId, String(x.member.joinedTimestamp), roleId,
    );
    expect(x.verification.beginAction).toHaveBeenCalledWith(
      guildId, x.interaction.id, targetId, actorId,
      String(x.member.joinedTimestamp), 'override',
    );
    expect(x.verification.claimRelease).toHaveBeenCalledWith(
      guildId, targetId, String(x.member.joinedTimestamp), true,
    );
    expect(x.member.roles.remove).toHaveBeenCalledWith(
      roleId, 'Yuugen staff verification override',
    );
    expect(x.verification.finishRelease).toHaveBeenCalledWith(
      guildId, targetId, String(x.member.joinedTimestamp), token, 'released',
    );
    expect(x.verification.finishAction).toHaveBeenCalledWith(
      guildId, 27, 'succeeded',
    );
    expect(x.member.roles.add).not.toHaveBeenCalled();
  });

  it('may explicitly exempt a pre-existing member already lacking quarantine', async () => {
    const x = setup();
    x.roles.delete(roleId);
    x.verification.getSession.mockResolvedValue(null);
    await x.command.onOverride([x.interaction] as any, {
      member: { id: targetId } as any,
    });
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    expect(x.verification.prepareOverride).toHaveBeenCalled();
    expect(x.verification.finishRelease).toHaveBeenCalledWith(
      guildId, targetId, String(x.member.joinedTimestamp), token, 'released',
    );
  });

  it('fails closed when bot loses role hierarchy or membership changes', async () => {
    const x = setup();
    (canSafelyRemoveQuarantineRole as jest.Mock).mockResolvedValueOnce(false);
    await x.command.onOverride([x.interaction] as any, {
      member: { id: targetId } as any,
    });
    expect(x.member.roles.remove).not.toHaveBeenCalled();
    expect(x.verification.finishAction).toHaveBeenCalledWith(
      guildId, 27, 'denied',
    );
  });

  it('records uncertain Discord removal without a second mutation', async () => {
    const x = setup();
    x.member.roles.remove.mockRejectedValueOnce(new Error('Timeout'));
    await x.command.onOverride([x.interaction] as any, {
      member: { id: targetId } as any,
    });
    expect(x.member.roles.remove).toHaveBeenCalledTimes(1);
    expect(x.verification.finishRelease).toHaveBeenCalledWith(
      guildId, targetId, String(x.member.joinedTimestamp),
      token, 'release_uncertain',
    );
    expect(x.verification.finishAction).toHaveBeenCalledWith(
      guildId, 27, 'uncertain',
    );
  });
});
