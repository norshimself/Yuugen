import { Injectable } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { EmbedBuilder } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

@Injectable()
export class WorkCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'work',
    description: 'Work a job to earn coins!',
  })
  public async onWork(@Context() [interaction]: SlashCommandContext) {
    const result = await this.economyService.work(interaction.user.id);

    if (!result.success) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('Slow down!')
        .setDescription(`You can work again <t:${Math.floor(result.nextClaim!.getTime() / 1000)}:R>.`)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor('#00FF00')
      .setTitle('Payday!')
      .setDescription(`You worked as a **${result.job}** and earned **${result.amount}** coins!`)
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
}
