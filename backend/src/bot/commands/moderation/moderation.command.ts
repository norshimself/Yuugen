import { Injectable, Logger } from '@nestjs/common';
import {
  Context,
  IntegerOption,
  Options,
  StringOption,
  Subcommand,
  UserOption,
  createCommandGroupDecorator,
} from 'necord';
import type { SlashCommandContext } from 'necord';
import {
  ChatInputCommandInteraction,
  Guild,
  GuildMember,
  MessageFlags,
  PermissionFlagsBits,
  User,
} from 'discord.js';
import { ModerationService } from '../../../domain/moderation/moderation.service';
import { getWarningDenial } from './warning-policy';

const ModerationGroup = createCommandGroupDecorator({
  name: 'mod',
  description: 'Server moderation and warning history',
});

class WarnOptions {
  @UserOption({
    name: 'user',
    description: 'Current guild member to warn',
    required: true,
  })
  user: User;

  @StringOption({
    name: 'reason',
    description: 'Reason shown in the moderation history (max 512 characters)',
    required: true,
  })
  reason: string;
}

class WarningHistoryOptions {
  @UserOption({
    name: 'user',
    description: 'User whose moderation warnings you want to view',
    required: true,
  })
  user: User;
}

class UnwarnOptions {
  @IntegerOption({
    name: 'id',
    description: 'Warning case number to revoke',
    required: true,
  })
  id: number;

  @StringOption({
    name: 'reason',
    description: 'Optional reason for removing this warning',
    required: false,
  })
  reason?: string;
}

interface StaffContext {
  guild: Guild;
  moderator: GuildMember;
}

@ModerationGroup()
@Injectable()
export class ModerationCommands {
  private readonly logger = new Logger(ModerationCommands.name);

  constructor(private readonly moderation: ModerationService) {}

  private async staffContext(
    interaction: ChatInputCommandInteraction,
  ): Promise<StaffContext | null> {
    const guild = interaction.guild;
    if (!guild || !interaction.guildId) return null;

    const moderator = await guild.members
      .fetch({ user: interaction.user.id, force: true })
      .catch(() => null);
    if (!moderator?.permissions.has(PermissionFlagsBits.ModerateMembers)) {
      return null;
    }
    return { guild, moderator };
  }

  @Subcommand({
    name: 'warn',
    description: 'Record a warning against a guild member',
  })
  public async onWarn(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user, reason }: WarnOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });

    const staff = await this.staffContext(interaction);
    if (!staff) {
      return interaction.editReply('This command requires a server moderator with Moderate Members permission.');
    }
    if (typeof reason !== 'string' || !reason.trim() || reason.trim().length > 512) {
      return interaction.editReply('Give a reason between 1 and 512 characters.');
    }

    const member = await staff.guild.members
      .fetch({ user: user.id, force: true })
      .catch(() => null);

    const denial = getWarningDenial({
      actorUserId: interaction.user.id,
      targetUserId: user.id,
      guildOwnerId: staff.guild.ownerId,
      actorHasModerateMembers: true,
      targetIsBot: user.bot,
      targetIsGuildMember: !!member,
      actorRoleAboveTarget: !!member &&
        staff.moderator.roles.highest.comparePositionTo(member.roles.highest) > 0,
    });
    if (denial) return interaction.editReply(denial);

    try {
      const saved = await this.moderation.warn(
        staff.guild.id,
        user.id,
        interaction.user.id,
        reason,
      );
      return interaction.editReply({
        content: 'Warning #' + saved.id + ' recorded for <@' + user.id +
          '>. Use /mod warnings to review or /mod unwarn to revoke it.',
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.error('Failed to record moderation warning', error);
      return interaction.editReply('Could not save that warning. Ask an administrator to check the database.');
    }
  }

  @Subcommand({
    name: 'warnings',
    description: 'Show the last 10 warnings for a user in this server',
  })
  public async onWarnings(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user }: WarningHistoryOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.staffContext(interaction);
    if (!staff) {
      return interaction.editReply('This command requires a server moderator with Moderate Members permission.');
    }

    try {
      const history = await this.moderation.warnings(staff.guild.id, user.id);
      if (history.length === 0) {
        return interaction.editReply('There are no recorded warnings for that user in this server.');
      }
      const entries = history.map((item) => {
        const created = Math.floor(new Date(item.createdAt).getTime() / 1000);
        const date = Number.isFinite(created) ? '<t:' + created + ':f>' : 'unknown date';
        const state = item.revokedAt ? 'revoked' : 'active';
        const reason = item.reason.length > 160
          ? item.reason.slice(0, 157) + '...'
          : item.reason;
        return '#' + item.id + ' (' + state + ') · ' + date +
          ' · by <@' + item.moderatorUserId + '>\n' + reason;
      });

      return interaction.editReply({
        content: ('**Warnings for <@' + user.id + '>**\n\n' + entries.join('\n\n'))
          .slice(0, 1950),
        allowedMentions: { parse: [] },
      });
    } catch (error) {
      this.logger.error('Failed to fetch moderation warnings', error);
      return interaction.editReply('Could not load warning history right now.');
    }
  }

  @Subcommand({
    name: 'unwarn',
    description: 'Revoke an active warning by its case number',
  })
  public async onUnwarn(
    @Context() [interaction]: SlashCommandContext,
    @Options() { id, reason }: UnwarnOptions,
  ) {
    await interaction.deferReply({ flags: MessageFlags.Ephemeral });
    const staff = await this.staffContext(interaction);
    if (!staff) {
      return interaction.editReply('This command requires a server moderator with Moderate Members permission.');
    }

    try {
      const revoked = await this.moderation.unwarn(
        staff.guild.id,
        id,
        interaction.user.id,
        reason && reason.trim() ? reason : 'Removed by moderator',
      );
      return interaction.editReply(revoked
        ? 'Warning #' + id + ' has been revoked. Its audit history is retained.'
        : 'No active warning with that case number exists in this server.');
    } catch (error) {
      this.logger.error('Failed to revoke moderation warning', error);
      return interaction.editReply('Could not revoke that warning. Check the case number and reason.');
    }
  }
}
