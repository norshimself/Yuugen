import { Injectable } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { EmbedBuilder } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

@Injectable()
export class BalanceCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'balance',
    description: 'Check your coin balance',
  })
  public async onBalance(@Context() [interaction]: SlashCommandContext) {
    const profile = await this.economyService.getProfile(interaction.user.id);

    const embed = new EmbedBuilder()
      .setTitle(`💰 ${interaction.user.username}'s Balance`)
      .setColor('#2ecc71')
      .addFields(
        { name: 'Wallet', value: `${profile.coins} 🪙`, inline: true },
        { name: 'Bank', value: `${profile.bank} 🪙`, inline: true },
        {
          name: 'Total',
          value: `${profile.coins + profile.bank} 🪙`,
          inline: true,
        },
      )
      .setThumbnail(interaction.user.displayAvatarURL() || null);

    return interaction.reply({ embeds: [embed] });
  }
}
