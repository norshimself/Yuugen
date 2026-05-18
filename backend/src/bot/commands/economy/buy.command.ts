import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, Options, StringOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { EmbedBuilder } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

class BuyOptions {
  @StringOption({
    name: 'item_id',
    description: 'The ID of the item to buy',
    required: true,
  })
  itemId: string;
}

@Injectable()
export class BuyCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'buy',
    description: 'Purchase an item from the shop!',
  })
  public async onBuy(
    @Context() [interaction]: SlashCommandContext,
    @Options() { itemId }: BuyOptions,
  ) {
    const result = await this.economyService.buyItem(interaction.user.id, itemId);

    const embed = new EmbedBuilder()
      .setColor(result.success ? '#00FF00' : '#FF0000')
      .setTitle(result.success ? 'Purchase Successful!' : 'Purchase Failed!')
      .setDescription(result.message)
      .setTimestamp();

    if (result.success && result.newBalance !== undefined) {
      embed.addFields({ name: 'New Balance', value: `💰 **${result.newBalance}** coins` });
    }

    return interaction.reply({ embeds: [embed], ephemeral: !result.success });
  }
}
