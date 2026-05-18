import { Injectable } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { EmbedBuilder } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

@Injectable()
export class CrimeCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'crime',
    description: 'Commit a crime for high risk, high reward!',
  })
  public async onCrime(@Context() [interaction]: SlashCommandContext) {
    const result = await this.economyService.crime(interaction.user.id);

    if (!result.success) {
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('Slow down!')
        .setDescription(`You can commit a crime again <t:${Math.floor(result.nextClaim!.getTime() / 1000)}:R>.`)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(result.won ? '#00FF00' : '#FF0000')
      .setTitle(result.won ? 'Success!' : 'Busted!')
      .setDescription(
        result.won
          ? `You **${result.crime}** and got away with **${result.amount}** coins!`
          : `You tried to **${result.crime}** but got caught! You paid a fine of **${result.amount}** coins.`,
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
}
