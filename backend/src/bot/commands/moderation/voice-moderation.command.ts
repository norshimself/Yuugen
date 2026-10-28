import { Injectable, Logger } from '@nestjs/common';
import {
  Button,
  ChannelOption,
  Context,
  Options,
  StringOption,
  Subcommand,
  UserOption,
} from 'necord';
import type { ButtonContext, SlashCommandContext } from 'necord';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonInteraction,
  ButtonStyle,
  ChannelType,
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  User,
  VoiceChannel,
  VoiceState,
  escapeMarkdown,
} from 'discord.js';
import { ModerationVoiceCaseService } from '../../../domain/moderation/moderation-voice-case.service';
import {
  VOICE_SNOWFLAKE,
  cleanVoiceReason,
  definitiveVoiceRejection,
  getVoiceActionDenial,
  type VoiceAction,
} from './voice-policy';
import { ModerationGroup } from './moderation-group';

class VoiceMemberOptions {
  @UserOption({
    name: 'user',
    description: 'Current guild member whose voice state will change',
    required: true,
  })
  user: User;

  @StringOption({
    name: 'reason',
    description: 'Moderation audit reason (1-512 characters)',
    required: true,
  })
  reason: string;
}

class VoiceSourceOptions {
  @UserOption({
    name: 'user',
    description: 'Member to disconnect from the specified voice channel',
    required: true,
  })
  user: User;

  @ChannelOption({
    name: 'source',
    description: 'Voice channel the member must currently occupy',
    required: true,
    channelTypes: [ChannelType.GuildVoice],
  })
  source: VoiceChannel;

  @StringOption({
    name: 'reason',
    description: 'Moderation audit reason (1-512 characters)',
    required: true,
  })
  reason: string;
}

class VoiceMoveOptions {
  @UserOption({
    name: 'user',
    description: 'One member to move',
    required: true,
  })
  user: User;

  @ChannelOption({
    name: 'source',
    description: 'Voice channel the member must be in',
    required: true,
    channelTypes: [ChannelType.GuildVoice],
  })
  source: VoiceChannel;

  @ChannelOption({
    name: 'destination',
    description: 'Different voice channel to move the member into',
    required: true,
    channelTypes: [ChannelType.GuildVoice],
  })
  destination: VoiceChannel;

  @StringOption({
    name: 'reason',
    description: 'Moderation audit reason (1-512 characters)',
    required: true,
  })
  reason: string;
}

class VoiceHistoryOptions {
  @UserOption({
    name: 'user',
    description: 'Current member whose voice moderation cases to inspect',
    required: false,
  })
  user?: User;

  @StringOption({
    name: 'user_id',
    description: 'Discord user ID of a departed member',
    required: false,
  })
  userId?: string;
}

interface VoicePending {
  guildId: string;
  actorId: string;
  targetId: string;
  action: VoiceAction;
  sourceChannelId: string;
  destinationChannelId: string | null;
  reason: string;
  expiresAt: number;
}

interface VoiceEvaluation {
  voice: VoiceState | null;
  source: VoiceChannel | null;
  destination: VoiceChannel | null;
  denial: string | null;
}

type VoiceInteraction = ChatInputCommandInteraction | ButtonInteraction;

@ModerationGroup({
  name: 'voice',
  description: 'Moderate individual members in voice channels',
})
@Injectable()
export class VoiceModerationCommands {
  private readonly logger = new Logger(VoiceModerationCommands.name);
  private readonly pending = new Map<string, VoicePending>();

  constructor(private readonly cases: ModerationVoiceCaseService) {}

  private requiredPermission(action: VoiceAction): bigint {
    if (action === 'mute' || action === 'unmute') {
      return PermissionFlagsBits.MuteMembers;
    }
    if (action === 'deafen' || action === 'undeafen') {
      return PermissionFlagsBits.DeafenMembers;
    }
    return PermissionFlagsBits.MoveMembers;
  }

  private async freshVoiceChannel(
    guild: Guild,
    id: string | null,
  ): Promise<VoiceChannel | null> {
    if (!id || !VOICE_SNOWFLAKE.test(id)) return null;
    const channel = await guild.channels.fetch(id, { force: true })
      .catch(() => null);
    if (!channel || channel.guildId !== guild.id ||
        channel.type !== ChannelType.GuildVoice) {
      return null;
    }
    // Restrict to standard voice channels; stage speakers have distinct rules.
    return channel as VoiceChannel;
  }

  private async evaluate(
    interaction: VoiceInteraction,
    action: VoiceAction,
    targetId: string,
    expectedSourceId: string | null,
    destinationId: string | null,
  ): Promise<VoiceEvaluation> {
    const invalid: VoiceEvaluation = {
      voice: null, source: null, destination: null,
      denial: 'Cannot verify guild voice membership and permissions.',
    };
    const guild = interaction.guild;
    if (!guild || !interaction.guildId || guild.id !== interaction.guildId) {
      return invalid;
    }
    const [actor, target, bot] = await Promise.all([
      guild.members.fetch({ user: interaction.user.id, force: true })
        .catch(() => null),
      guild.members.fetch({ user: targetId, force: true })
        .catch(() => null),
      guild.members.fetchMe().catch(() => null),
    ]);
    if (!actor || !target || !bot) return invalid;

    // Fetch the live voice state from Discord rather than relying only on
    // the gateway cache. Missing state is never assumed to mean connected.
    const voice = await target.voice.fetch(true).catch(() => null);
    const sourceId = expectedSourceId || voice?.channelId || null;
    const [source, destination] = await Promise.all([
      this.freshVoiceChannel(guild, sourceId),
      action === 'move'
        ? this.freshVoiceChannel(guild, destinationId)
        : Promise.resolve(null),
    ]);
    const permission = this.requiredPermission(action);
    const sourceActorPerms = source ? source.permissionsFor(actor) : null;
    const sourceBotPerms = source ? source.permissionsFor(bot) : null;
    const destinationActorPerms = destination
      ? destination.permissionsFor(actor) : null;
    const destinationBotPerms = destination
      ? destination.permissionsFor(bot) : null;
    const hasSourceAccess = (perms: typeof sourceActorPerms): boolean =>
      !!perms?.has(PermissionFlagsBits.ViewChannel) &&
      !!perms?.has(permission);
    const hasDestinationAccess = (
      perms: typeof destinationActorPerms,
    ): boolean => !!perms?.has(PermissionFlagsBits.ViewChannel) &&
      !!perms?.has(PermissionFlagsBits.MoveMembers);
    const denial = getVoiceActionDenial({
      action,
      actorId: actor.id,
      targetId,
      guildOwnerId: guild.ownerId,
      targetExists: true,
      targetIsBot: target.user.bot,
      targetIsAdministrator: target.permissions.has(
        PermissionFlagsBits.Administrator,
      ),
      actorAboveTarget: actor.roles.highest.comparePositionTo(
        target.roles.highest,
      ) > 0,
      botAboveTarget: bot.roles.highest.comparePositionTo(
        target.roles.highest,
      ) > 0,
      sourceChannelId: sourceId,
      connectedChannelId: voice?.channelId || null,
      sourceIsVoice: !!source,
      destinationChannelId: destinationId,
      destinationIsVoice: !!destination,
      actorCanModerateSource: hasSourceAccess(sourceActorPerms),
      botCanModerateSource: hasSourceAccess(sourceBotPerms),
      actorCanModerateDestination: hasDestinationAccess(destinationActorPerms),
      botCanModerateDestination: hasDestinationAccess(destinationBotPerms),
      actorCanConnectDestination: !!destinationActorPerms?.has(
        PermissionFlagsBits.Connect,
      ),
      botCanConnectDestination: !!destinationBotPerms?.has(
        PermissionFlagsBits.Connect,
      ),
      serverMute: voice?.serverMute ?? null,
      serverDeaf: voice?.serverDeaf ?? null,
    });
    return { voice, source, destination, denial };
  }

  private expirePrompts(): void {
    const now = Date.now();
    for (const [key, value] of this.pending) {
      if (value.expiresAt <= now) this.pending.delete(key);
    }
  }

  private async preview(
    interaction: ChatInputCommandInteraction,
    action: VoiceAction,
    user: User,
    reasonText: string,
    explicitSource?: VoiceChannel,
    explicitDestination?: VoiceChannel,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild || !interaction.guildId) {
      return interaction.editReply('Voice moderation is only available in servers.');
    }
    if (explicitSource && explicitSource.guildId !== guild.id ||
        explicitDestination && explicitDestination.guildId !== guild.id) {
      return interaction.editReply('Both voice channels must belong to this server.');
    }
    if ((action === 'move' || action === 'disconnect') && !explicitSource) {
      return interaction.editReply('Specify the member’s current source channel.');
    }
    if (action === 'move' && !explicitDestination) {
      return interaction.editReply('A destination voice channel is required.');
    }
    const reason = cleanVoiceReason(reasonText);
    if (!reason) {
      return interaction.editReply('Provide a reason between 1 and 512 characters.');
    }
    const inspected = await this.evaluate(
      interaction, action, user.id,
      explicitSource?.id || null,
      explicitDestination?.id || null,
    );
    if (inspected.denial || !inspected.voice?.channelId) {
      return interaction.editReply(
        inspected.denial || 'This member is not connected to voice.',
      );
    }
    this.expirePrompts();
    if (this.pending.size >= 100) {
      return interaction.editReply(
        'Too many pending voice moderation confirmations. Try again.',
      );
    }
    const sourceId = inspected.voice.channelId;
    const destinationId = action === 'move' ? explicitDestination!.id : null;
    const components = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('mod-voice-confirm')
        .setLabel('Confirm ' + action)
        .setStyle(ButtonStyle.Danger),
      new ButtonBuilder()
        .setCustomId('mod-voice-cancel')
        .setLabel('Cancel')
        .setStyle(ButtonStyle.Secondary),
    );
    const message = await interaction.editReply({
      content: '**Confirm voice ' + action + ' for <@' + user.id + '>**' +
        '\nSource: <#' + sourceId + '>' +
        (destinationId ? '\nDestination: <#' + destinationId + '>' : '') +
        '\nReason: ' + escapeMarkdown(reason) +
        '\nOne member only. Only you may confirm within 60 seconds.',
      allowedMentions: { parse: [] },
      components: [components],
    });
    this.pending.set(message.id, {
      guildId: guild.id,
      actorId: interaction.user.id,
      targetId: user.id,
      action,
      sourceChannelId: sourceId,
      destinationChannelId: destinationId,
      reason,
      expiresAt: Date.now() + 60_000,
    });
  }

  @Subcommand({ name: 'mute', description: 'Server-mute one connected member' })
  public onMute(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, reason }: VoiceMemberOptions,
  ) {
    return this.preview(interaction, 'mute', user, reason);
  }

  @Subcommand({ name: 'unmute', description: 'Remove a member’s server mute' })
  public onUnmute(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, reason }: VoiceMemberOptions,
  ) {
    return this.preview(interaction, 'unmute', user, reason);
  }

  @Subcommand({ name: 'deafen', description: 'Server-deafen one connected member' })
  public onDeafen(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, reason }: VoiceMemberOptions,
  ) {
    return this.preview(interaction, 'deafen', user, reason);
  }

  @Subcommand({ name: 'undeafen', description: 'Remove a member’s server deafen' })
  public onUndeafen(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, reason }: VoiceMemberOptions,
  ) {
    return this.preview(interaction, 'undeafen', user, reason);
  }

  @Subcommand({ name: 'disconnect', description: 'Disconnect one member from a specified voice channel' })
  public onDisconnect(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, source, reason }: VoiceSourceOptions,
  ) {
    return this.preview(interaction, 'disconnect', user, reason, source);
  }

  @Subcommand({ name: 'move', description: 'Move one member between two specified voice channels' })
  public onMove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, source, destination, reason }: VoiceMoveOptions,
  ) {
    return this.preview(
      interaction, 'move', user, reason, source, destination,
    );
  }

  @Subcommand({ name: 'history', description: 'View recent voice moderation cases for a user' })
  public async onHistory(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, userId }: VoiceHistoryOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const guild = interaction.guild;
    if (!guild || !interaction.guildId) {
      return interaction.editReply('Use this command in a server.');
    }
    const actor = await guild.members.fetch({
      user: interaction.user.id, force: true,
    }).catch(() => null);
    if (!actor ||
        !actor.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
      return interaction.editReply('View Audit Log permission is required.');
    }
    if (user && userId) {
      return interaction.editReply('Provide either user or user_id, not both.');
    }
    const targetId = user?.id || userId?.trim();
    if (!targetId || !VOICE_SNOWFLAKE.test(targetId)) {
      return interaction.editReply('Specify a valid Discord user or user ID.');
    }
    try {
      const cases = await this.cases.recent(guild.id, targetId);
      if (cases.length === 0) {
        return interaction.editReply('No voice moderation cases for this user in this guild.');
      }
      return interaction.editReply({
        content: ('**Voice moderation history for <@' + targetId + '>**\n' +
          cases.map(item =>
            '#' + item.id + ' ' + item.action + ' (' + item.status + ')' +
            ' · <#' + item.sourceChannelId + '>' +
            (item.destinationChannelId
              ? ' → <#' + item.destinationChannelId + '>'
              : '') +
            ' · by <@' + item.moderatorUserId + '>' +
            '\n' + escapeMarkdown(item.reason.slice(0, 120)),
          ).join('\n')).slice(0, 1950),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.error('Could not load voice moderation case history', error);
      return interaction.editReply('Could not load voice moderation history.');
    }
  }

  @Button('mod-voice-cancel')
  public async onCancel(@Context() [interaction]: ButtonContext) {
    const pending = this.pending.get(interaction.message.id);
    if (!pending || pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This voice action confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }
    this.pending.delete(interaction.message.id);
    return interaction.update({
      content: 'Voice moderation canceled. No changes were made.',
      components: [],
    });
  }

  @Button('mod-voice-confirm')
  public async onConfirm(@Context() [interaction]: ButtonContext) {
    const pending = this.pending.get(interaction.message.id);
    if (!pending || pending.actorId !== interaction.user.id ||
        pending.guildId !== interaction.guildId) {
      return interaction.reply({
        content: 'This voice action confirmation is not yours or has expired.',
        flags: MessageFlags.Ephemeral,
      });
    }
    // Consume before the first await to prevent double clicks from replaying.
    this.pending.delete(interaction.message.id);
    await interaction.deferUpdate();
    if (pending.expiresAt <= Date.now()) {
      return interaction.editReply({
        content: 'Voice confirmation expired. Run the command again.',
        components: [],
      });
    }

    const first = await this.evaluate(
      interaction, pending.action, pending.targetId,
      pending.sourceChannelId, pending.destinationChannelId,
    );
    if (first.denial || !first.voice) {
      return interaction.editReply({
        content: 'Voice action canceled: ' +
          (first.denial || 'could not verify current voice state.'),
        components: [],
      });
    }

    let record: Awaited<ReturnType<ModerationVoiceCaseService['begin']>>;
    try {
      record = await this.cases.begin({
        guildId: pending.guildId,
        targetUserId: pending.targetId,
        moderatorUserId: pending.actorId,
        sourceChannelId: pending.sourceChannelId,
        destinationChannelId: pending.destinationChannelId,
        action: pending.action,
        reason: pending.reason,
      });
    } catch (error) {
      this.logger.error('Could not persist voice action audit', error);
      return interaction.editReply({
        content: 'No voice action attempted: the audit database is unavailable.',
        components: [],
      });
    }
    if (!record) {
      return interaction.editReply({
        content: 'This member has another pending voice moderation action. ' +
          'Check the audit and resolve it before retrying.',
        components: [],
      });
    }

    // Revalidate after the DB reservation. The target could move or the
    // moderator could lose permission while the insert is in flight.
    const second = await this.evaluate(
      interaction, pending.action, pending.targetId,
      pending.sourceChannelId, pending.destinationChannelId,
    );
    if (second.denial || !second.voice) {
      try {
        await this.cases.finish(
          pending.guildId, record.id, pending.action, 'failed',
        );
      } catch (error) {
        this.logger.error('Cannot mark canceled voice action as failed', error);
      }
      return interaction.editReply({
        content: 'Voice action canceled after rechecking: ' +
          (second.denial || 'target disconnected.'),
        components: [],
      });
    }

    const reason = (
      'Yuugen voice case #' + record.id + ', moderator ' +
      pending.actorId + ': ' + pending.reason
    ).slice(0, 512);
    try {
      if (pending.action === 'mute' || pending.action === 'unmute') {
        await second.voice.setMute(pending.action === 'mute', reason);
      } else if (pending.action === 'deafen' ||
          pending.action === 'undeafen') {
        await second.voice.setDeaf(pending.action === 'deafen', reason);
      } else if (pending.action === 'disconnect') {
        await second.voice.disconnect(reason);
      } else {
        if (!second.destination) {
          throw new Error('Destination changed before voice move');
        }
        await second.voice.setChannel(second.destination, reason);
      }
    } catch (error) {
      const definitive = definitiveVoiceRejection(error);
      let failed = false;
      if (definitive) {
        try {
          failed = !!await this.cases.finish(
            pending.guildId, record.id, pending.action, 'failed',
          );
        } catch (saveError) {
          this.logger.error('Failed to finalize rejected voice action', saveError);
        }
      }
      this.logger.warn('Voice moderation case #' + record.id +
        (definitive ? ' rejected' : ' has uncertain outcome'));
      return interaction.editReply({
        content: failed
          ? 'Discord rejected the voice action. Case #' + record.id +
            ' is marked failed.'
          : 'Voice action outcome is unknown. Case #' + record.id +
            ' remains pending. Check Discord voice state before retrying.',
        components: [],
      });
    }

    let finished = false;
    try {
      finished = !!await this.cases.finish(
        pending.guildId, record.id, pending.action, 'completed',
      );
    } catch (error) {
      this.logger.error('Voice action succeeded; audit finalization failed', error);
    }
    if (!finished) {
      return interaction.editReply({
        content: 'Discord accepted the voice action, but case #' +
          record.id + ' remains pending. Reconcile it manually.',
        components: [],
      });
    }
    return interaction.editReply({
      content: 'Voice ' + pending.action + ' completed for <@' +
        pending.targetId + '> in <#' + pending.sourceChannelId + '>' +
        (pending.destinationChannelId
          ? ' → <#' + pending.destinationChannelId + '>'
          : '') +
        '. Case #' + record.id + ' recorded.',
      components: [],
      allowedMentions: { parse: [] },
    });
  }
}
