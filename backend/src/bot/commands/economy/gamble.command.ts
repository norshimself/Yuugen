import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, Options, IntegerOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { EmbedBuilder } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

class GambleOptions {
  @IntegerOption({
    name: 'amount',
    description: 'The amount of coins to bet',
    required: true,
  })
  amount: number;
}

@Injectable()
export class GambleCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'gamble',
    description: 'Double or nothing! Gamble your coins with a 50% chance.',
  })
  public async onGamble(
    @Context() [interaction]: SlashCommandContext,
    @Options() { amount }: GambleOptions,
  ) {
    if (amount <= 0) {
      return interaction.reply({
        content: 'You must bet at least 1 coin!',
        ephemeral: true,
      });
    }

    const result = await this.economyService.gamble(
      interaction.user.id,
      amount,
    );

    if (!result.success) {
      return interaction.reply({
        content: `You don't have enough coins!`,
        ephemeral: true,
      });
    }

    const embed = new EmbedBuilder().setTitle('🎰 Gambling Result').setFooter({
      text: `Gamble by ${interaction.user.username}`,
      iconURL: interaction.user.displayAvatarURL() || undefined,
    });

    if (result.won) {
      embed
        .setColor('#2ecc71')
        .setDescription(
          `🎉 You won! You doubled your bet and gained **${amount}** coins!\nNew Balance: **${result.newBalance}** coins.`,
        );
    } else {
      embed
        .setColor('#e74c3c')
        .setDescription(
          `😢 You lost! You lost **${amount}** coins.\nNew Balance: **${result.newBalance}** coins.`,
        );
    }

    return interaction.reply({ embeds: [embed] });
  }
}
