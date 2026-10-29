import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  ActionRowBuilder, ButtonInteraction, GuildMember, MessageFlags,
  ModalBuilder, ModalSubmitInteraction, TextInputBuilder, TextInputStyle,
} from 'discord.js';
import { Context, On } from 'necord';
import type { ContextOf } from 'necord';
import { RolePanelService } from '../../domain/roles/role-panel.service';
import { VerificationService } from '../../domain/verification/verification.service';
import {
  answerModalId, canSelfRelease, freshJoin, MAX_QUESTION_ATTEMPTS,
  parseVerificationComponent, validJoinSession, type VerificationSessionStatus,
} from '../../domain/verification/verification-policy';
import {
  canSafelyRemoveQuarantineRole, inspectVerificationEnvironment,
} from '../../domain/verification/verification-discord';
import type { GuildVerificationConfig } from '../../domain/verification/guild-verification-config.entity';

type VerificationInteraction = ButtonInteraction | ModalSubmitInteraction;
type AuditOutcome = 'succeeded' | 'denied' | 'failed' | 'uncertain';
type ReleaseOutcome = 'released' | 'quarantined' | 'release_uncertain';

@Injectable()
export class VerificationListener {
  private readonly logger = new Logger(VerificationListener.name);

  constructor(
    private readonly verification: VerificationService,
    private readonly memberLocks: RolePanelService,
    private readonly config: ConfigService,
  ) {}

  get membersIntentEnabled(): boolean {
    return this.config.get<string>('ENABLE_GUILD_MEMBERS_INTENT') === 'true';
  }

  /**
   * Only a newly observed, actually joined guild member may be quarantined.
   * A SQL claim and audit record precede any Discord role add.
   */
  @On('guildMemberAdd')
  async onGuildMemberAdd(member: GuildMember): Promise<void> {
    if (!this.membersIntentEnabled || member.user.bot ||
        !member.joinedTimestamp || !freshJoin(member.joinedTimestamp, Date.now())) {
      return;
    }
    const guildId = member.guild.id;
    const sessionKey = String(member.joinedTimestamp);
    if (!validJoinSession(sessionKey)) return;
    let lease: { token: string; coolingDown: boolean } | null = null;
    let claim: string | null = null;
    let actionId: number | null = null;
    let attemptedMutation = false;
    let joinResult: Extract<VerificationSessionStatus,
      'quarantined' | 'join_failed' | 'join_uncertain'> = 'join_uncertain';
    let auditResult: AuditOutcome = 'uncertain';
    try {
      const configured = await this.verification.activeConfig(guildId);
      if (!configured) return;
      lease = await this.memberLocks.acquireMember(guildId, member.id);
      if (!lease || lease.coolingDown) return;

      const [current, bot] = await Promise.all([
        member.guild.members.fetch({
          user: member.id, force: true,
        }).catch(() => null),
        member.guild.members.fetchMe().catch(() => null),
      ]);
      if (!current || !bot || current.user.bot ||
          String(current.joinedTimestamp) !== sessionKey) return;
      claim = await this.verification.claimJoin(
        guildId, member.id, sessionKey, configured.quarantineRoleId,
      );
      if (!claim) return; // duplicate, stale or configuration now disabled

      actionId = await this.verification.beginAction(
        guildId, 'join:' + member.id + ':' + sessionKey,
        member.id, member.id, sessionKey, 'join',
      );
      if (!actionId) return;
      const updated = await this.verification.activeConfig(guildId);
      if (!updated || updated.revision !== configured.revision ||
          updated.quarantineRoleId !== configured.quarantineRoleId ||
          updated.channelId !== configured.channelId ||
          !await this.memberLocks.hasMemberLease(guildId, member.id, lease.token)) {
        joinResult = 'join_failed';
        auditResult = 'denied';
        return;
      }
      const inspected = await inspectVerificationEnvironment(
        member.guild, bot, updated.channelId, updated.quarantineRoleId,
      );
      if (inspected.denial) {
        joinResult = 'join_failed';
        auditResult = 'denied';
        return;
      }
      const otherRoles = [...current.roles.cache.keys()].filter(
        roleId => roleId !== guildId && roleId !== updated.quarantineRoleId,
      );
      if (otherRoles.length > 0) {
        // Other member roles might override quarantine permission denies.
        joinResult = 'join_failed';
        auditResult = 'denied';
        return;
      }
      if (!current.roles.cache.has(updated.quarantineRoleId)) {
        attemptedMutation = true;
        try {
          await current.roles.add(
            updated.quarantineRoleId, 'Yuugen verification quarantine for new join',
          );
        } catch (error) {
          const code = error && typeof error === 'object' && 'code' in error
            ? error.code : null;
          joinResult = code === 50013 ? 'join_failed' : 'join_uncertain';
          auditResult = code === 50013 ? 'failed' : 'uncertain';
          return;
        }
      }
      const confirmed = await member.guild.members.fetch({
        user: member.id, force: true,
      }).catch(() => null);
      if (!confirmed || String(confirmed.joinedTimestamp) !== sessionKey ||
          !confirmed.roles.cache.has(updated.quarantineRoleId)) return;
      joinResult = 'quarantined';
      auditResult = 'succeeded';
    } catch (error) {
      this.logger.warn('Verification join outcome uncertain; no automatic retry', error);
    } finally {
      if (claim) {
        await this.verification.finishJoin(
          guildId, member.id, sessionKey, claim, joinResult,
        ).catch(error => this.logger.error('Could not reconcile join state', error));
      }
      if (actionId) {
        await this.verification.finishAction(
          guildId, actionId, auditResult,
        ).catch(error => this.logger.error('Could not finalize join audit', error));
      }
      if (lease) {
        await this.memberLocks.releaseMember(
          guildId, member.id, lease.token, attemptedMutation,
        ).catch(error => this.logger.error('Could not release member lease', error));
      }
    }
  }

  @On('interactionCreate')
  async onInteraction(
    @Context() [interaction]: ContextOf<'interactionCreate'>,
  ): Promise<void> {
    if (!interaction.isButton() && !interaction.isModalSubmit()) return;
    if (!interaction.customId.startsWith('yverify:')) return;
    const parsed = parseVerificationComponent(interaction.customId);
    if (!parsed || !interaction.guild || !interaction.guildId ||
        interaction.guildId !== parsed.guildId) {
      await interaction.reply({
        content: 'Verification must be completed in the original server.',
        flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
      }).catch(() => null);
      return;
    }
    try {
      const config = await this.verification.activeConfig(parsed.guildId);
      if (!config || config.revision !== parsed.revision ||
          (parsed.kind === 'open' &&
            (!interaction.isButton() ||
              interaction.channelId !== config.channelId ||
              interaction.message.id !== config.messageId)) ||
          (parsed.kind === 'answer' && (!interaction.isModalSubmit() ||
            config.mode !== 'question'))) {
        await interaction.reply({
          content: 'This verification control is disabled or outdated.',
          flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
        });
        return;
      }
      const member = await interaction.guild.members.fetch({
        user: interaction.user.id, force: true,
      }).catch(() => null);
      const session = member && await this.verification.getSession(
        parsed.guildId, member.id,
      );
      if (!member || !session || !member.joinedTimestamp ||
          !canSelfRelease(session.status,
            member.roles.cache.has(session.quarantineRoleId),
            String(member.joinedTimestamp), session.sessionKey) ||
          session.quarantineRoleId !== config.quarantineRoleId ||
          session.wrongAnswers >= MAX_QUESTION_ATTEMPTS) {
        await interaction.reply({
          content: 'Verification is unavailable for this membership session. Ask staff for help.',
          flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
        });
        return;
      }
      if (parsed.kind === 'open' && interaction.isButton() &&
          config.mode === 'question') {
        const modalId = answerModalId(
          parsed.guildId, parsed.revision, session.sessionKey,
        );
        if (!modalId) return;
        const input = new TextInputBuilder()
          .setCustomId('answer')
          .setLabel(config.questionPrompt || 'Answer the verification question')
          .setStyle(TextInputStyle.Short)
          .setRequired(true).setMinLength(1).setMaxLength(80);
        await interaction.showModal(new ModalBuilder()
          .setCustomId(modalId)
          .setTitle('Member verification')
          .addComponents(
            new ActionRowBuilder<TextInputBuilder>().addComponents(input),
          ));
        return;
      }
      if (parsed.kind === 'answer' && interaction.isModalSubmit()) {
        if (parsed.sessionKey !== session.sessionKey) {
          await interaction.reply({
            content: 'This question was opened for a previous membership session.',
            flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
          });
          return;
        }
        // No answer content is ever forwarded to a database row or log.
        const submitted = interaction.fields.getTextInputValue('answer');
        if (!this.verification.answerMatches(config, submitted)) {
          await interaction.deferReply({ flags: MessageFlags.Ephemeral });
          const id = await this.verification.beginAction(
            parsed.guildId, interaction.id, member.id, member.id,
            session.sessionKey, 'wrong_answer',
          );
          if (!id) {
            await interaction.editReply('This answer attempt was already handled.');
            return;
          }
          const attempts = await this.verification.countWrongAnswer(
            parsed.guildId, member.id, session.sessionKey,
          );
          await this.verification.finishAction(
            parsed.guildId, id, attempts === null ? 'denied' : 'failed',
          );
          await interaction.editReply(
            'Answer not accepted. ' +
            (attempts === null || attempts >= MAX_QUESTION_ATTEMPTS
              ? 'No more self-service attempts are available; contact staff.'
              : 'Please try again.'),
          );
          return;
        }
      }
      if (parsed.kind === 'open' && config.mode !== 'button') return;
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      await this.releaseMember(interaction, config, member, session.sessionKey);
    } catch (error) {
      this.logger.warn('Verification interaction failed without retry', error);
      if (!interaction.deferred && !interaction.replied) {
        await interaction.reply({
          content: 'Verification is temporarily unavailable. Contact staff.',
          flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] },
        }).catch(() => null);
      } else if (interaction.deferred) {
        await interaction.editReply(
          'Verification outcome is unconfirmed. Ask staff to inspect your role.',
        ).catch(() => null);
      }
    }
  }

  /** Self-service verification can only REMOVE the one configured role. */
  private async releaseMember(
    interaction: VerificationInteraction,
    config: GuildVerificationConfig,
    member: GuildMember,
    sessionKey: string,
  ): Promise<void> {
    const guild = member.guild;
    let lease: { token: string; coolingDown: boolean } | null = null;
    let claim: { token: string; roleId: string } | null = null;
    let actionId: number | null = null;
    let mutationAttempted = false;
    let releaseOutcome: ReleaseOutcome = 'quarantined';
    let actionOutcome: AuditOutcome = 'denied';
    try {
      lease = await this.memberLocks.acquireMember(guild.id, member.id);
      if (!lease || lease.coolingDown) {
        await interaction.editReply('Another role action is in progress. Try again in a few seconds.');
        return;
      }
      const current = await this.verification.activeConfig(guild.id);
      if (!current || current.revision !== config.revision ||
          current.quarantineRoleId !== config.quarantineRoleId ||
          current.messageId !== config.messageId) {
        await interaction.editReply('Verification settings changed. No role was removed.');
        return;
      }
      actionId = await this.verification.beginAction(
        guild.id, interaction.id, member.id, member.id, sessionKey, 'verify',
      );
      if (!actionId) {
        await interaction.editReply('This verification interaction was already processed.');
        return;
      }
      claim = await this.verification.claimRelease(
        guild.id, member.id, sessionKey, false,
      );
      if (!claim || claim.roleId !== config.quarantineRoleId) {
        await interaction.editReply('Membership session is no longer eligible for verification.');
        return;
      }
      const [bot, fresh] = await Promise.all([
        guild.members.fetchMe().catch(() => null),
        guild.members.fetch({ user: member.id, force: true }).catch(() => null),
      ]);
      if (!bot || !fresh || String(fresh.joinedTimestamp) !== sessionKey ||
          !fresh.roles.cache.has(claim.roleId) ||
          !await this.memberLocks.hasMemberLease(guild.id, member.id, lease.token) ||
          !await canSafelyRemoveQuarantineRole(guild, bot, claim.roleId)) {
        await interaction.editReply(
          'Cannot safely release your quarantine role. Contact a moderator.',
        );
        return;
      }
      const live = await this.verification.activeConfig(guild.id);
      if (!live || live.revision !== config.revision ||
          live.messageId !== config.messageId ||
          live.quarantineRoleId !== config.quarantineRoleId) {
        await interaction.editReply('Verification was disabled before the role change.');
        return;
      }
      mutationAttempted = true;
      try {
        await fresh.roles.remove(claim.roleId, 'Yuugen confirmed member verification');
      } catch {
        releaseOutcome = 'release_uncertain';
        actionOutcome = 'uncertain';
        await interaction.editReply(
          'Discord did not confirm removal. Staff must inspect your roles before retrying.',
        );
        return;
      }
      const confirmed = await guild.members.fetch({
        user: member.id, force: true,
      }).catch(() => null);
      if (!confirmed || String(confirmed.joinedTimestamp) !== sessionKey ||
          confirmed.roles.cache.has(claim.roleId)) {
        releaseOutcome = 'release_uncertain';
        actionOutcome = 'uncertain';
        await interaction.editReply('Verification result unconfirmed; ask staff to inspect your roles.');
        return;
      }
      releaseOutcome = 'released';
      actionOutcome = 'succeeded';
      await interaction.editReply('Verified. Your quarantine role was removed.');
    } catch (error) {
      this.logger.warn('Verification role removal uncertain; no retry', error);
      if (mutationAttempted) {
        releaseOutcome = 'release_uncertain';
        actionOutcome = 'uncertain';
      }
      await interaction.editReply('Could not verify role removal. Contact staff.')
        .catch(() => null);
    } finally {
      if (claim) {
        await this.verification.finishRelease(
          guild.id, member.id, sessionKey, claim.token, releaseOutcome,
        ).catch(error => this.logger.error('Cannot finalize verification session', error));
      }
      if (actionId) {
        await this.verification.finishAction(
          guild.id, actionId, actionOutcome,
        ).catch(error => this.logger.error('Cannot finalize verification action', error));
      }
      if (lease) {
        await this.memberLocks.releaseMember(
          guild.id, member.id, lease.token, mutationAttempted,
        ).catch(error => this.logger.error('Cannot release verification member lock', error));
      }
    }
  }
}
