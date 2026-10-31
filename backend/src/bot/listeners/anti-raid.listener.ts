import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { On } from 'necord';
import { ChannelType, GuildMember, PermissionFlagsBits } from 'discord.js';
import { AntiRaidService } from '../../domain/security/anti-raid.service';

/**
 * Opt-in alerts only: no member role mutations, kicks, bans or timeouts.
 * Errors and missing permissions never trigger a punitive fallback.
 */
@Injectable()
export class AntiRaidListener {
  private readonly logger = new Logger(AntiRaidListener.name);

  constructor(
    private readonly antiRaid: AntiRaidService,
    private readonly config: ConfigService,
  ) {}

  @On('guildMemberAdd')
  async onJoin(member: GuildMember): Promise<void> {
    if (this.config.get<string>('ENABLE_GUILD_MEMBERS_INTENT') !== 'true' ||
        member.user.bot || !member.joinedTimestamp) return;
    try {
      const alert = await this.antiRaid.observeJoin({
        guildId: member.guild.id,
        userId: member.id,
        joinedAtMs: member.joinedTimestamp,
        accountCreatedAtMs: member.user.createdTimestamp,
        observedAtMs: Date.now(),
        roleIds: [...member.roles.cache.keys()],
      });
      if (!alert) return;
      const channel = await member.guild.channels.fetch(alert.alertChannelId)
        .catch(() => null);
      const bot = member.guild.members.me ||
        await member.guild.members.fetchMe().catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText || !bot ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages)) {
        await this.antiRaid.finishAlert(alert.guildId, alert.alertId, 'missing_permissions');
        this.logger.warn('Anti-raid alert channel unavailable (no moderation action)');
        return;
      }
      // The alert deliberately contains aggregates only. Never mention members
      // or @everyone; require staff to review actual guild context.
      await channel.send({
        content:
          'Anti-raid review requested: ' + alert.joinCount +
          ' eligible member joins in ' + alert.windowSeconds +
          ' seconds' +
          (alert.minAccountAgeMinutes === 0 ? ' (account-age filter disabled)' :
            ', including a joining account younger than ' +
              alert.minAccountAgeMinutes + ' minutes') +
          '. This is an alert only. Review before taking moderation action.',
        allowedMentions: { parse: [] },
      });
      await this.antiRaid.finishAlert(alert.guildId, alert.alertId, 'sent');
    } catch (error) {
      // A Discord send could have succeeded before a network exception.
      // Leave the precommitted audit pending for staff reconciliation.
      this.logger.warn('Anti-raid observation or delivery failed; no action performed', error);
    }
  }
}
