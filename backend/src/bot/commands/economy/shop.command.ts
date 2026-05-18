import { Injectable } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { EmbedBuilder } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

@Injectable()
export class ShopCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'shop',
    description: 'View items available for purchase in the shop!',
  })
  public async onShop(@Context() [interaction]: SlashCommandContext) {
    const items = this.economyService.getShopItems();

    const embed = new EmbedBuilder()
      .setColor('#9b59b6')
      .setTitle('🏪 The Shop')
      .setDescription('Use `/buy <item_id>` to purchase an item!')
      .setTimestamp();

    items.forEach(item => {
      embed.addFields({
        name: `${item.name} (ID: \`${item.id}\`)`,
        value: `💰 **${item.price}** coins\n${item.description}`,
      });
    });

    return interaction.reply({ embeds: [embed] });
  }
}
