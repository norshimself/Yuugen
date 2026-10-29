import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { On } from 'necord';
import {
  ActionRowBuilder,
  AttachmentBuilder, ButtonBuilder, ButtonStyle,
  ChannelType, GuildMember, Interaction, PermissionFlagsBits,
} from 'discord.js';
import { createCanvas, loadImage } from '@napi-rs/canvas';
import { SettingsService } from '../../domain/settings/settings.service';
import { OnboardingService } from '../../domain/onboarding/onboarding.service';
import {
  DEFAULT_GOODBYE_MESSAGE, DEFAULT_WELCOME_DM_MESSAGE,
  canAcknowledgeRules, formatOnboardingMessage, isDMDisabledError,
  isRecentOnboardingJoin, parseRulesButtonId, rulesButtonId,
  validSessionKey, validSnowflake,
} from '../../domain/onboarding/onboarding-policy';

/** Compatibility helper used by the existing welcome template tests. */
export function formatWelcomeMessage(
  template: string, userMention: string, guildName: string,
): string {
  return formatOnboardingMessage(template, userMention, guildName, 2000);
}

@Injectable()
export class WelcomeListener {
  private readonly logger = new Logger(WelcomeListener.name);

  constructor(
    private readonly settingsService: SettingsService,
    private readonly onboarding: OnboardingService,
    private readonly config: ConfigService,
  ) {}

  private get membersIntentEnabled(): boolean {
    return this.config.get<string>('ENABLE_GUILD_MEMBERS_INTENT') === 'true';
  }

  /** Image preparation is isolated from the Discord API send. */
  private async buildWelcomeImage(member: GuildMember): Promise<AttachmentBuilder> {
    const canvas = createCanvas(700, 250);
    const ctx = canvas.getContext('2d');

    ctx.fillStyle = '#23272a';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = '#ffffff';
    ctx.font = '35px sans-serif';
    ctx.fillText('Welcome to the server!', 250, 100);
    ctx.fillStyle = '#7289da';
    ctx.font = '30px sans-serif';
    ctx.fillText(member.user.username.slice(0, 40), 250, 150);
    ctx.fillStyle = '#aaaaaa';
    ctx.font = '20px sans-serif';
    ctx.fillText('Member #' + member.guild.memberCount, 250, 200);

    const avatar = await loadImage(
      member.user.displayAvatarURL({ extension: 'png', size: 128 }),
    );
    ctx.beginPath();
    ctx.arc(125, 125, 60, 0, Math.PI * 2, true);
    ctx.closePath();
    ctx.clip();
    ctx.drawImage(avatar, 65, 65, 120, 120);

    return new AttachmentBuilder(canvas.toBuffer('image/png'), {
      name: 'welcome-image.png',
    });
  }

  private async sendPublicWelcome(
    member: GuildMember, sessionKey: string, now: number,
    channelId: string,
  ): Promise<void> {
    const receipt = await this.onboarding.reserve(
      member.guild.id, member.id, 'welcome', sessionKey, now,
    );
    if (!receipt) return;
    const current = await this.settingsService.getSettings(member.guild.id, true);
    if (!current.welcomeChannelId || current.welcomeChannelId !== channelId) {
      await this.onboarding.finish(member.guild.id, receipt, 'config_changed');
      return;
    }
    const channel = await member.guild.channels.fetch(channelId).catch(() => null);
    const bot = member.guild.members.me ||
      await member.guild.members.fetchMe().catch(() => null);
    if (!channel || channel.type !== ChannelType.GuildText || !bot ||
        !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
        !channel.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages)) {
      await this.onboarding.finish(member.guild.id, receipt, 'missing_permissions');
      return;
    }
    const content = formatWelcomeMessage(
      current.welcomeMessage || 'Welcome {user} to the server!',
      '<@' + member.id + '>', member.guild.name,
    );
    // Only the joining user can be pinged; mass and role mentions are off.
    const allowedMentions = { parse: [] as never[], users: [member.id] };
    let image: AttachmentBuilder | null = null;
    if (channel.permissionsFor(bot)?.has(PermissionFlagsBits.AttachFiles)) {
      try {
        image = await this.buildWelcomeImage(member);
      } catch {
        // Image preparation failure is known: send plain text exactly once.
      }
    }
    // NEVER fall back to a second send after an ambiguous Discord API error.
    await channel.send({
      content, allowedMentions, ...(image ? { files: [image] } : {}),
    });
    await this.onboarding.finish(member.guild.id, receipt, 'sent');
  }

  private async sendFirstTimeDM(
    member: GuildMember, sessionKey: string, now: number,
  ): Promise<void> {
    const receipt = await this.onboarding.reserve(
      member.guild.id, member.id, 'welcome_dm', sessionKey, now,
    );
    if (!receipt) return;
    const current = await this.settingsService.getSettings(member.guild.id, true);
    if (!current.welcomeDmEnabled) {
      await this.onboarding.finish(member.guild.id, receipt, 'config_changed');
      return;
    }
    const components: ActionRowBuilder<ButtonBuilder>[] = [];
    if (current.rulesAcknowledgementEnabled) {
      const channelId = current.rulesChannelId;
      const customId = rulesButtonId(member.guild.id, sessionKey);
      const rulesChannel = channelId && validSnowflake(channelId)
        ? await member.guild.channels.fetch(channelId).catch(() => null)
        : null;
      if (!customId || !rulesChannel || rulesChannel.type !== ChannelType.GuildText ||
          !rulesChannel.permissionsFor(member)?.has(PermissionFlagsBits.ViewChannel)) {
        await this.onboarding.finish(member.guild.id, receipt, 'missing_permissions');
        return;
      }
      components.push(new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setLabel('Read the rules')
          .setStyle(ButtonStyle.Link)
          .setURL('https://discord.com/channels/' + member.guild.id + '/' + channelId),
        new ButtonBuilder()
          .setCustomId(customId)
          .setLabel('I have read the rules')
          .setStyle(ButtonStyle.Primary),
      ));
    }

    const content = formatOnboardingMessage(
      current.welcomeDmMessage || DEFAULT_WELCOME_DM_MESSAGE,
      member.user.username, member.guild.name,
    );
    try {
      await member.user.send({
        content, allowedMentions: { parse: [] }, components,
      });
      await this.onboarding.finish(member.guild.id, receipt, 'sent');
    } catch (error) {
      if (isDMDisabledError(error)) {
        // Discord error 50007: user privacy settings block bot DMs.
        await this.onboarding.finish(member.guild.id, receipt, 'dm_unavailable');
      } else {
        // Network status may be ambiguous. Stay pending; never retry blind.
        this.logger.warn('Onboarding DM response was uncertain');
      }
    }
  }

  @On('guildMemberAdd')
  public async onGuildMemberAdd(member: GuildMember): Promise<void> {
    if (!this.membersIntentEnabled || member.user.bot) return;
    const now = Date.now();
    const joined = member.joinedTimestamp;
    if (joined === null || !isRecentOnboardingJoin(joined, now)) return;
    const sessionKey = String(joined);
    if (!validSessionKey(sessionKey)) return;

    try {
      const current = await this.settingsService.getSettings(member.guild.id);
      if (current.welcomeChannelId) {
        try {
          await this.sendPublicWelcome(
            member, sessionKey, now, current.welcomeChannelId,
          );
        } catch {
          this.logger.warn('Public welcome delivery was uncertain');
        }
      }
      // DM is independent of any public announcement destination.
      if (current.welcomeDmEnabled) {
        try {
          await this.sendFirstTimeDM(member, sessionKey, now);
        } catch {
          this.logger.warn('First-time DM setup failed without retry');
        }
      }
    } catch {
      this.logger.warn('Could not load onboarding settings for a joining member');
    }
  }

  @On('guildMemberRemove')
  public async onGuildMemberRemove(member: GuildMember): Promise<void> {
    if (!this.membersIntentEnabled || member.user.bot) return;
    const now = Date.now();
    // Joined timestamp is stable for the departing session. When Discord
    // omits it, one-minute bucketing avoids unbounded replay notifications.
    const sessionKey = validSessionKey(String(member.joinedTimestamp))
      ? String(member.joinedTimestamp)
      : String(Math.floor(now / 60_000) * 60_000);
    try {
      const current = await this.settingsService.getSettings(member.guild.id);
      if (!current.goodbyeChannelId) return;
      const receipt = await this.onboarding.reserve(
        member.guild.id, member.id, 'goodbye', sessionKey, now,
      );
      if (!receipt) return;
      const fresh = await this.settingsService.getSettings(member.guild.id, true);
      if (!fresh.goodbyeChannelId ||
          fresh.goodbyeChannelId !== current.goodbyeChannelId) {
        await this.onboarding.finish(member.guild.id, receipt, 'config_changed');
        return;
      }
      const channel = await member.guild.channels
        .fetch(fresh.goodbyeChannelId).catch(() => null);
      const bot = member.guild.members.me ||
        await member.guild.members.fetchMe().catch(() => null);
      if (!channel || channel.type !== ChannelType.GuildText || !bot ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.ViewChannel) ||
          !channel.permissionsFor(bot)?.has(PermissionFlagsBits.SendMessages)) {
        await this.onboarding.finish(member.guild.id, receipt, 'missing_permissions');
        return;
      }
      const content = formatOnboardingMessage(
        fresh.goodbyeMessage || DEFAULT_GOODBYE_MESSAGE,
        '<@' + member.id + '>', member.guild.name,
      );
      await channel.send({ content, allowedMentions: { parse: [] } });
      await this.onboarding.finish(member.guild.id, receipt, 'sent');
    } catch {
      this.logger.warn('Goodbye delivery was uncertain; not retrying');
    }
  }

  /** Only a live member may acknowledge their own current-session DM. */
  @On('interactionCreate')
  public async onInteraction(interaction: Interaction): Promise<void> {
    if (!interaction.isButton() ||
        !interaction.customId.startsWith('yuugen:rules:')) return;
    const parsed = parseRulesButtonId(interaction.customId);
    if (!parsed || interaction.guildId) return;
    try {
      const guild = interaction.client.guilds.cache.get(parsed.guildId);
      const member = await guild?.members.fetch({
        user: interaction.user.id, force: true,
      }).catch(() => null);
      const now = Date.now();
      const fresh = guild && await this.settingsService.getSettings(guild.id, true);
      if (!this.membersIntentEnabled || !member || !member.joinedTimestamp ||
          !fresh?.welcomeDmEnabled || !fresh.rulesAcknowledgementEnabled ||
          !canAcknowledgeRules(parsed.sessionKey, member.joinedTimestamp, now)) {
        await interaction.reply({
          content: 'This rules acknowledgement is no longer available.',
          allowedMentions: { parse: [] },
        });
        return;
      }
      const recorded = await this.onboarding.acknowledge(
        guild.id, interaction.user.id, parsed.sessionKey,
      );
      if (!recorded) {
        await interaction.reply({
          content: 'Your acknowledgement was already recorded or is unavailable.',
          allowedMentions: { parse: [] },
        });
        return;
      }
      await interaction.update({
        content: 'Rules acknowledgement recorded. Thank you!',
        components: [], allowedMentions: { parse: [] },
      });
    } catch {
      this.logger.warn('Rules acknowledgement could not be completed');
      if (!interaction.replied && !interaction.deferred) {
        await interaction.reply({
          content: 'Acknowledgement is temporarily unavailable.',
          allowedMentions: { parse: [] },
        }).catch(() => undefined);
      }
    }
  }
}
