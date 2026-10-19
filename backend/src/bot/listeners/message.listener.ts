import { Injectable } from '@nestjs/common';
import { Context, On } from 'necord';
import type { ContextOf } from 'necord';
import { EconomyService } from '../../domain/economy/economy.service';
import { SettingsService } from '../../domain/settings/settings.service';
import { inspectMessage, MessageActivity } from './moderation';

@Injectable()
export class MessageListener {
  private readonly activity = new Map<string, MessageActivity>();

  constructor(
    private readonly economyService: EconomyService,
    private readonly settingsService: SettingsService,
  ) {}

  @On('messageCreate')
  async onMessage(@Context() [message]: ContextOf<'messageCreate'>) {
    if (message.author.bot || !message.guildId) return;

    const now = Date.now();
    try {
      const settings = await this.settingsService.getSettings(message.guildId);
      const key = `${message.guildId}:${message.author.id}`;
      const moderation = inspectMessage(
        message.content || '',
        settings,
        now,
        this.activity.get(key),
      );

      // Limit in-memory activity tracking to avoid unbounded growth.
      this.activity.delete(key);
      this.activity.set(key, moderation.activity);
      if (this.activity.size > 5000) {
        for (const [candidate, value] of this.activity) {
          if (now - value.lastAt > 12_000) this.activity.delete(candidate);
        }
        if (this.activity.size > 5000) {
          const oldest = this.activity.keys().next().value;
          if (oldest !== undefined) this.activity.delete(oldest);
        }
      }

      if (moderation.reason) {
        // Never reward messages that violate a guild's active rules.
        if (message.deletable) {
          await message.delete().catch((error) =>
            console.warn('Unable to delete moderated message:', error),
          );
        }
        return;
      }
    } catch (error) {
      // A temporary settings/database failure should not crash Discord events.
      console.warn('Could not evaluate guild moderation settings:', error);
    }

    try {
      const xpToAdd = Math.floor(Math.random() * 11) + 5;
      const result = await this.economyService.addXp(message.author.id, xpToAdd);
      if (result.leveledUp) {
        await message.reply(
          `🎉 Congrats ${message.author.username}, you leveled up to **Level ${result.level}**!`,
        );
      }
    } catch (error) {
      console.warn('Failed to award message XP:', error);
    }
  }
}
