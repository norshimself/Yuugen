import { createHash } from 'node:crypto';
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
  private readonly attachments = new Map<string, { time: number; count: number }[]>();
  private readonly repeated = new Map<string, { time: number; hash: string }[]>();
  private readonly seen = new Map<string, number>();
  private readonly lastDryRun = new Map<string, number>();
  private readonly lastDelete = new Map<string, number>();

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
    // Never retain plaintext user messages. Hash only normalized non-empty
    // content for per-author, per-guild duplicate detection.
    const normalized = (message.content || '').normalize('NFKC').trim().toLowerCase().slice(0, 2000);
    const hash = normalized.length >= 8
      ? createHash('sha256').update(normalized).digest('hex') : '';
    const recentAttachments = (this.attachments.get(key) || [])
      .filter(entry => now - entry.time < 60000);
    recentAttachments.push({ time: now, count: Math.min(message.attachments.size, 20) });
    const recentContent = (this.repeated.get(key) || [])
      .filter(entry => now - entry.time < 60000);
    if (hash) recentContent.push({ time: now, hash });
    this.attachments.delete(key);
    this.attachments.set(key, recentAttachments.slice(-100));
    this.repeated.delete(key);
    this.repeated.set(key, recentContent.slice(-100));
    if (this.attachments.size > 5000) this.attachments.delete(this.attachments.keys().next().value!);
    if (this.repeated.size > 5000) this.repeated.delete(this.repeated.keys().next().value!);
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
        // Discord.js collections deduplicate user and role mentions. Count
        // @everyone/@here once as a broadcast; never parse spoofed text.
        mentionCount: message.mentions.users.size + message.mentions.roles.size +
          (message.mentions.everyone ? 1 : 0),
        attachmentCountInWindow: seconds => recentAttachments
          .filter(entry => now - entry.time < seconds * 1000)
          .reduce((total, entry) => total + entry.count, 0),
        sameContentCountInWindow: seconds => hash
          ? recentContent.filter(entry =>
              entry.hash === hash && now - entry.time < seconds * 1000).length
          : 0,
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
      // Bound repeat deletion for a flood; no escalating punishments.
      const deleteKey = message.guildId + ':' + message.author.id + ':' + decision.ruleId;
      if (now - (this.lastDelete.get(deleteKey) || 0) < 1500) return;
      if (this.lastDelete.size > 5000) this.lastDelete.clear();
      if (message.deletable) {
        await message.delete();
        this.lastDelete.set(deleteKey, now);
      } else {
        this.logger.warn('AutoMod matched, but message cannot be deleted');
      }
    } catch (error) {
      this.logger.warn('AutoMod evaluation failed (no delete performed)', error);
    }
  }
}
