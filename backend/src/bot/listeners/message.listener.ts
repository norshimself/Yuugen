import { Injectable } from '@nestjs/common';
import { Context, On } from 'necord';
import type { ContextOf } from 'necord';
import { EconomyService } from '../../domain/economy/economy.service';

@Injectable()
export class MessageListener {
  constructor(private readonly economyService: EconomyService) {}

  @On('messageCreate')
  async onMessage(@Context() [message]: ContextOf<'messageCreate'>) {
    if (message.author.bot) return;

    // Add random XP between 5 and 15
    const xpToAdd = Math.floor(Math.random() * 11) + 5;
    const result = await this.economyService.addXp(message.author.id, xpToAdd);

    if (result.leveledUp) {
      await message.reply(
        `🎉 Congrats ${message.author.username}, you leveled up to **Level ${result.level}**!`,
      );
    }
  }
}
