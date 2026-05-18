import { Injectable } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { EmbedBuilder } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

@Injectable()
export class DailyCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'daily',
    description: 'Claim your daily coins!',
  })
  public async onDaily(@Context() [interaction]: SlashCommandContext) {
    const result = await this.economyService.claimDaily(interaction.user.id);
    
    const embed = new EmbedBuilder();
    
    if (result.success) {
      embed
        .setTitle('Daily Reward Claimed!')
        .setDescription(`You received **${result.amount}** coins!`)
        .setColor('#43b581');
    } else {
      const timeLeft = result.nextClaim!.getTime() - new Date().getTime();
      const hours = Math.floor(timeLeft / (1000 * 60 * 60));
      const minutes = Math.floor((timeLeft % (1000 * 60 * 60)) / (1000 * 60));
      
      embed
        .setTitle('Too Early!')
        .setDescription(`You can claim your next daily reward in **${hours}h ${minutes}m**.`)
        .setColor('#f04747');
    }

    return interaction.reply({ embeds: [embed] });
  }
}
