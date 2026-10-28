import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Context, On } from 'necord';
import type { ContextOf } from 'necord';
import { AutoModRulesService } from '../../domain/moderation/automod-rules.service';
import { evaluateAutoMod } from '../../domain/moderation/automod-policy';

/**
 * Replaces unregistered legacy message moderation listener with opt-in,
 * per-guild rules. Does not read or award XP. Rule exceptions are enforced
 * before any delete, and dry-run NEVER changes a message.
 */
@Injectable()
export class AutoModMessageListener {
  private readonly logger = new Logger(AutoModMessageListener.name);
  private readonly windows = new Map<string, number[]>();
  private readonly seen = new Map<string, number>();
  private readonly lastDryRun = new Map<string, number>();

  constructor(
    private readonly rules: AutoModRulesService,
    private readonly config: ConfigService,
  ) {}

  @On('messageCreate')
  async onMessage(@Context() [message]: ContextOf<'messageCreate'>): Promise<void> {
    if (!message.guildId || message.author.bot || message.webhookId ||
        !message.channelId) return;
    // Message content and its privileged intent are disabled by default.
    if (this.config.get<string>('ENABLE_MESSAGE_CONTENT_INTENT') !== 'true') return;
    const now = Date.now();
    if (this.seen.has(message.id)) return;
    this.seen.set(message.id, now);
    if (this.seen.size > 10000) {
      for (const [id, time] of this.seen) {
        if (now - time > 120000) this.seen.delete(id);
      }
      if (this.seen.size > 10000) this.seen.clear();
    }

    const key = message.guildId + ':' + message.author.id;
    const previous = (this.windows.get(key) || [])
      .filter(time => now - time < 60000);
    previous.push(now);
    this.windows.delete(key);
    this.windows.set(key, previous);
    if (this.windows.size > 5000) {
      for (const [id, times] of this.windows) {
        if (now - (times[times.length - 1] || 0) > 60000) this.windows.delete(id);
      }
      if (this.windows.size > 5000) this.windows.delete(this.windows.keys().next().value!);
    }

    try {
      const rules = await this.rules.list(message.guildId);
      if (!rules.some(rule => rule.enabled)) return;

      // Unknown member roles could conceal an exemption: never delete.
      const member = message.member || await message.guild?.members.fetch({
        user: message.author.id, force: true,
      }).catch(() => null);
      if (!member) return;
      const roles = member.roles.cache.keys();
      const decision = evaluateAutoMod(rules, {
        channelId: message.channelId,
        roleIds: roles ? [...roles] : [],
        content: message.content || '',
        messageCountInWindow: seconds =>
          previous.filter(time => now - time < seconds * 1000).length,
      });
      if (!decision) return;

      if (decision.action === 'dry_run') {
        const alertKey = message.guildId + ':' + decision.ruleId;
        if (now - (this.lastDryRun.get(alertKey) || 0) > 30000) {
          this.lastDryRun.set(alertKey, now);
          this.logger.log(
            'AutoMod dry-run guild=' + message.guildId + ' rule=' +
            decision.ruleId + ' kind=' + decision.kind +
            ' (would delete; no message contents logged)',
          );
        }
        return;
      }
      if (message.deletable) {
        await message.delete();
      } else {
        this.logger.warn('AutoMod matched, but message cannot be deleted');
      }
    } catch (error) {
      this.logger.warn('AutoMod evaluation failed (no delete performed)', error);
    }
  }
}
