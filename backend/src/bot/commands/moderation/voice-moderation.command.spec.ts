import {
  ChannelType,
  PermissionFlagsBits,
  User,
} from 'discord.js';
import { ModerationVoiceCaseService } from '../../../domain/moderation/moderation-voice-case.service';
import { VoiceModerationCommands } from './voice-moderation.command';

describe('/mod voice interactions', () => {
  const guildId = '123456789012345678';
  const actorId = '234567890123456789';
  const targetId = '345678901234567890';
  const ownerId = '456789012345678901';
  const sourceId = '567890123456789012';
  const destinationId = '678901234567890123';
  const confirmationId = '789012345678901234';

  function setup(options: {
    actorCanSource?: boolean;
    botCanSource?: boolean;
    actorCanDestination?: boolean;
    botCanDestination?: boolean;
    actorCanConnect?: boolean;
    botCanConnect?: boolean;
    actorAbove?: boolean;
    botAbove?: boolean;
    targetAdmin?: boolean;
    targetBot?: boolean;
    serverMute?: boolean;
    serverDeaf?: boolean;
    connected?: boolean;
    hasAuditPermission?: boolean;
  } = {}) {
    const sourceActorPermissions = {
      has: jest.fn().mockReturnValue(options.actorCanSource !== false),
    };
    const sourceBotPermissions = {
      has: jest.fn().mockReturnValue(options.botCanSource !== false),
    };
    const destActorPermissions = {
      has: jest.fn((p: bigint) =>
        options.actorCanDestination !== false &&
        (p !== PermissionFlagsBits.Connect || options.actorCanConnect !== false)),
    };
    const destBotPermissions = {
      has: jest.fn((p: bigint) =>
        options.botCanDestination !== false &&
        (p !== PermissionFlagsBits.Connect || options.botCanConnect !== false)),
    };
    const actor = {
      id: actorId,
      roles: { highest: { comparePositionTo: jest.fn().mockReturnValue(
        options.actorAbove === false ? -1 : 1,
      ) } },
      permissions: {
        has: jest.fn((p: bigint) =>
          p !== PermissionFlagsBits.ViewAuditLog ||
          options.hasAuditPermission !== false),
      },
    };
    const bot = {
      id: '890123456789012345',
      roles: { highest: { comparePositionTo: jest.fn().mockReturnValue(
        options.botAbove === false ? -1 : 1,
      ) } },
    };
    const voice = {
      channelId: options.connected === false ? null as string | null : sourceId,
      serverMute: options.serverMute === true,
      serverDeaf: options.serverDeaf === true,
      setMute: jest.fn(async (value: boolean) => {
        voice.serverMute = value;
      }),
      setDeaf: jest.fn(async (value: boolean) => {
        voice.serverDeaf = value;
      }),
      disconnect: jest.fn(async () => {
        voice.channelId = null;
      }),
      setChannel: jest.fn(async (channel: { id: string }) => {
        voice.channelId = channel.id;
      }),
      fetch: jest.fn().mockImplementation(async () => voice),
    };
    const target = {
      id: targetId,
      user: { bot: options.targetBot === true },
      permissions: { has: jest.fn((p: bigint) =>
        p === PermissionFlagsBits.Administrator &&
        options.targetAdmin === true),
      },
      roles: { highest: {} },
      voice,
    };
    const source = {
      id: sourceId,
      guildId,
      type: ChannelType.GuildVoice,
      permissionsFor: jest.fn((member: unknown) =>
        member === actor ? sourceActorPermissions :
          member === bot ? sourceBotPermissions : null),
    };
    const destination = {
      id: destinationId,
      guildId,
      type: ChannelType.GuildVoice,
      permissionsFor: jest.fn((member: unknown) =>
        member === actor ? destActorPermissions :
          member === bot ? destBotPermissions : null),
    };
    const guild = {
      id: guildId,
      ownerId,
      members: {
        fetch: jest.fn(async ({ user }: { user: string }) =>
          user === actorId ? actor : user === targetId ? target : null),
        fetchMe: jest.fn().mockResolvedValue(bot),
      },
      channels: {
        fetch: jest.fn(async (id: string) =>
          id === sourceId ? source : id === destinationId ? destination : null),
      },
    };
    const slash = {
      guild,
      guildId,
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
      deferUpdate: jest.fn().mockResolvedValue(undefined),
      editReply: jest.fn().mockResolvedValue(undefined),
      update: jest.fn().mockResolvedValue(undefined),
    };
    const cases = {
      begin: jest.fn().mockResolvedValue({ id: 81, status: 'pending' }),
      finish: jest.fn().mockResolvedValue({ id: 81, status: 'completed' }),
      recent: jest.fn().mockResolvedValue([]),
    } as unknown as ModerationVoiceCaseService;
    const commands = new VoiceModerationCommands(cases);
    const user = { id: targetId } as User;
    const reason = 'Repeated voice disruption';
    return {
      commands, slash, button, guild, actor, bot, target,
      source, destination, voice, user, reason, cases,
      sourceActorPermissions, sourceBotPermissions,
      destActorPermissions, destBotPermissions,
    };
  }

  async function previewMute(s: ReturnType<typeof setup>) {
    return s.commands.onMute([s.slash] as any, {
      user: s.user, reason: s.reason,
    });
  }
  async function previewMove(s: ReturnType<typeof setup>) {
    return s.commands.onMove([s.slash] as any, {
      user: s.user, source: s.source, destination: s.destination,
      reason: s.reason,
    });
  }

  it('previews mute privately without modifying voice or DB', async () => {
    const s = setup();
    await previewMute(s);
    expect(s.cases.begin).not.toHaveBeenCalled();
    expect(s.voice.setMute).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Confirm voice mute'),
      components: expect.any(Array),
      allowedMentions: { parse: [] },
    }));
  });

  it('requires Mute Members permission in the source for actor and bot', async () => {
    for (const opts of [{ actorCanSource: false }, { botCanSource: false }]) {
      const s = setup(opts);
      await previewMute(s);
      expect(s.cases.begin).not.toHaveBeenCalled();
      expect(s.voice.setMute).not.toHaveBeenCalled();
      expect(s.slash.editReply).toHaveBeenCalledWith(
        expect.stringContaining(opts.actorCanSource === false
          ? 'You lack' : 'Yuugen lacks'),
      );
    }
  });

  it('rejects wrong role hierarchy and bot, owner and admin targets', async () => {
    for (const opts of [
      { actorAbove: false },
      { botAbove: false },
      { targetAdmin: true },
      { targetBot: true },
    ]) {
      const s = setup(opts);
      await previewMute(s);
      expect(s.cases.begin).not.toHaveBeenCalled();
      expect(s.voice.setMute).not.toHaveBeenCalled();
    }
    const s = setup();
    s.guild.ownerId = targetId;
    await previewMute(s);
    expect(s.voice.setMute).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('owner'),
    );
  });

  it('refuses disconnected members and unresolved voice state', async () => {
    const s = setup({ connected: false });
    await previewMute(s);
    expect(s.cases.begin).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('expected voice channel'),
    );
  });

  it('prevents repeated server mutes and removes only an existing server mute', async () => {
    const muted = setup({ serverMute: true });
    await previewMute(muted);
    expect(muted.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('already server-muted'),
    );
    const unmuted = setup();
    await unmuted.commands.onUnmute([unmuted.slash] as any, {
      user: unmuted.user, reason: unmuted.reason,
    });
    expect(unmuted.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('not server-muted'),
    );
    const valid = setup({ serverMute: true });
    await valid.commands.onUnmute([valid.slash] as any, {
      user: valid.user, reason: valid.reason,
    });
    await valid.commands.onConfirm([valid.button] as any);
    expect(valid.voice.setMute).toHaveBeenCalledWith(
      false, expect.stringContaining('case #81'),
    );
  });

  it('deafens and undeafens using server deafen only', async () => {
    const deafen = setup();
    await deafen.commands.onDeafen([deafen.slash] as any, {
      user: deafen.user, reason: deafen.reason,
    });
    await deafen.commands.onConfirm([deafen.button] as any);
    expect(deafen.voice.setDeaf).toHaveBeenCalledWith(true, expect.any(String));

    const undeafen = setup({ serverDeaf: true });
    await undeafen.commands.onUndeafen([undeafen.slash] as any, {
      user: undeafen.user, reason: undeafen.reason,
    });
    await undeafen.commands.onConfirm([undeafen.button] as any);
    expect(undeafen.voice.setDeaf).toHaveBeenCalledWith(false, expect.any(String));
  });

  it('disconnects exactly the named member from an explicitly named source', async () => {
    const s = setup();
    await s.commands.onDisconnect([s.slash] as any, {
      user: s.user, source: s.source, reason: s.reason,
    });
    await s.commands.onConfirm([s.button] as any);
    expect(s.voice.disconnect).toHaveBeenCalledWith(
      expect.stringContaining('case #81'),
    );
    expect(s.cases.begin).toHaveBeenCalledWith(expect.objectContaining({
      action: 'disconnect', sourceChannelId: sourceId,
      destinationChannelId: null,
    }));
    expect(s.voice.channelId).toBeNull();
  });

  it('rejects disconnect when target changed its voice source', async () => {
    const s = setup();
    await s.commands.onDisconnect([s.slash] as any, {
      user: s.user, source: s.source, reason: s.reason,
    });
    s.voice.channelId = destinationId;
    await s.commands.onConfirm([s.button] as any);
    expect(s.cases.begin).not.toHaveBeenCalled();
    expect(s.voice.disconnect).not.toHaveBeenCalled();
  });

  it('requires an explicit source and different destination for moves', async () => {
    const s = setup();
    await s.commands.onMove([s.slash] as any, {
      user: s.user, source: undefined as any,
      destination: s.destination, reason: s.reason,
    });
    await s.commands.onMove([s.slash] as any, {
      user: s.user, source: s.source,
      destination: s.source as any, reason: s.reason,
    });
    expect(s.cases.begin).not.toHaveBeenCalled();
    expect(s.voice.setChannel).not.toHaveBeenCalled();
  });

  it('requires Move Members in both channels and Connect in destination', async () => {
    for (const opts of [
      { actorCanSource: false },
      { botCanSource: false },
      { actorCanDestination: false },
      { botCanDestination: false },
      { actorCanConnect: false },
      { botCanConnect: false },
    ]) {
      const s = setup(opts);
      await previewMove(s);
      expect(s.cases.begin).not.toHaveBeenCalled();
      expect(s.slash.editReply).toHaveBeenCalledWith(
        expect.stringContaining('need'),
      );
    }
  });

  it('moves only one target from the specified source to destination', async () => {
    const s = setup();
    await previewMove(s);
    await s.commands.onConfirm([s.button] as any);
    expect(s.voice.setChannel).toHaveBeenCalledWith(
      s.destination, expect.stringContaining('case #81'),
    );
    expect(s.cases.begin).toHaveBeenCalledWith(expect.objectContaining({
      guildId, targetUserId: targetId,
      sourceChannelId: sourceId, destinationChannelId: destinationId,
      action: 'move', reason: s.reason,
    }));
    expect(s.cases.finish).toHaveBeenCalledWith(
      guildId, 81, 'move', 'completed',
    );
  });

  it('rejects source/destination options pointing at another guild', async () => {
    const s = setup();
    await s.commands.onMove([s.slash] as any, {
      user: s.user,
      source: { ...s.source, guildId: ownerId },
      destination: s.destination,
      reason: s.reason,
    });
    expect(s.guild.channels.fetch).not.toHaveBeenCalled();
    expect(s.cases.begin).not.toHaveBeenCalled();
  });

  it('rechecks moderator and bot permission at confirmation', async () => {
    for (const actor of [true, false]) {
      const s = setup();
      await previewMute(s);
      (actor ? s.sourceActorPermissions : s.sourceBotPermissions)
        .has.mockReturnValue(false);
      await s.commands.onConfirm([s.button] as any);
      expect(s.cases.begin).not.toHaveBeenCalled();
      expect(s.voice.setMute).not.toHaveBeenCalled();
    }
  });

  it('checks live source and target state again after saving the audit reservation', async () => {
    const s = setup();
    (s.cases.begin as jest.Mock).mockImplementation(async () => {
      s.voice.channelId = destinationId;
      return { id: 81, status: 'pending' };
    });
    await previewMute(s);
    await s.commands.onConfirm([s.button] as any);
    expect(s.voice.setMute).not.toHaveBeenCalled();
    expect(s.cases.finish).toHaveBeenCalledWith(
      guildId, 81, 'mute', 'failed',
    );
  });

  it('writes an audit case before Discord voice modification', async () => {
    const s = setup();
    await previewMute(s);
    await s.commands.onConfirm([s.button] as any);
    expect(s.cases.begin).toHaveBeenCalledTimes(1);
    expect(s.voice.setMute).toHaveBeenCalledWith(
      true, expect.stringContaining('moderator ' + actorId),
    );
    expect(s.cases.finish).toHaveBeenCalledWith(
      guildId, 81, 'mute', 'completed',
    );
    expect((s.cases.begin as jest.Mock).mock.invocationCallOrder[0])
      .toBeLessThan(s.voice.setMute.mock.invocationCallOrder[0]);
    expect(s.voice.setMute.mock.invocationCallOrder[0])
      .toBeLessThan((s.cases.finish as jest.Mock).mock.invocationCallOrder[0]);
  });

  it('rejects unauthorized user/guild, cancel and expired confirmations', async () => {
    const s = setup();
    await previewMute(s);
    s.button.user.id = ownerId;
    await s.commands.onConfirm([s.button] as any);
    s.button.user.id = actorId;
    s.button.guildId = ownerId;
    await s.commands.onConfirm([s.button] as any);
    expect(s.cases.begin).not.toHaveBeenCalled();
    expect(s.button.reply).toHaveBeenCalledTimes(2);
    s.button.guildId = guildId;
    await s.commands.onCancel([s.button] as any);
    await s.commands.onConfirm([s.button] as any);
    expect(s.cases.begin).not.toHaveBeenCalled();

    const expired = setup();
    await previewMute(expired);
    const pending = (expired.commands as unknown as {
      pending: Map<string, { expiresAt: number }>;
    }).pending;
    pending.get(confirmationId)!.expiresAt = Date.now() - 1;
    await expired.commands.onConfirm([expired.button] as any);
    expect(expired.cases.begin).not.toHaveBeenCalled();
  });

  it('never calls Discord when inserting the audit fails or another action is pending', async () => {
    const failure = setup();
    (failure.cases.begin as jest.Mock).mockRejectedValueOnce(new Error('DB down'));
    await previewMute(failure);
    await failure.commands.onConfirm([failure.button] as any);
    expect(failure.voice.setMute).not.toHaveBeenCalled();

    const conflict = setup();
    (conflict.cases.begin as jest.Mock).mockResolvedValueOnce(null);
    await previewMute(conflict);
    await conflict.commands.onConfirm([conflict.button] as any);
    expect(conflict.voice.setMute).not.toHaveBeenCalled();
    expect(conflict.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('another pending'),
    }));
  });

  it('only performs a single action for two concurrent clicks', async () => {
    const s = setup();
    await previewMute(s);
    await Promise.all([
      s.commands.onConfirm([s.button] as any),
      s.commands.onConfirm([s.button] as any),
    ]);
    expect(s.cases.begin).toHaveBeenCalledTimes(1);
    expect(s.voice.setMute).toHaveBeenCalledTimes(1);
  });

  it('records explicit Discord permission rejection as failed', async () => {
    const s = setup();
    s.voice.setMute.mockRejectedValueOnce({ status: 403, code: 50013 });
    await previewMute(s);
    await s.commands.onConfirm([s.button] as any);
    expect(s.cases.finish).toHaveBeenCalledWith(
      guildId, 81, 'mute', 'failed',
    );
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('Discord rejected'),
    }));
  });

  it('preserves a pending case when Discord times out ambiguously', async () => {
    const s = setup();
    s.voice.setMute.mockRejectedValueOnce(new Error('Connection reset'));
    await previewMute(s);
    await s.commands.onConfirm([s.button] as any);
    expect(s.cases.finish).not.toHaveBeenCalled();
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('outcome is unknown'),
    }));
  });

  it('does not claim audit success when the finalization database write fails', async () => {
    const s = setup();
    (s.cases.finish as jest.Mock).mockRejectedValueOnce(new Error('DB down'));
    await previewMute(s);
    await s.commands.onConfirm([s.button] as any);
    expect(s.voice.setMute).toHaveBeenCalledTimes(1);
    expect(s.button.editReply).toHaveBeenCalledWith(expect.objectContaining({
      content: expect.stringContaining('remains pending'),
    }));
  });

  it('restricts voice history to View Audit Log and to the interaction guild', async () => {
    const s = setup({ hasAuditPermission: false });
    await s.commands.onHistory([s.slash] as any, { user: s.user });
    expect(s.cases.recent).not.toHaveBeenCalled();
    expect(s.slash.editReply).toHaveBeenCalledWith(
      expect.stringContaining('View Audit Log'),
    );
    const allowed = setup();
    await allowed.commands.onHistory([allowed.slash] as any, { user: allowed.user });
    expect(allowed.cases.recent).toHaveBeenCalledWith(guildId, targetId);
  });
});
