import { Injectable } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { EmbedBuilder } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

@Injectable()
export class RankCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'rank',
    description: 'View your current level and XP.',
  })
  public async onRank(@Context() [interaction]: SlashCommandContext) {
    const profile = await this.economyService.getProfile(interaction.user.id);
    const xpNeeded = profile.level * 100;

    const embed = new EmbedBuilder()
      .setTitle(`${interaction.user.username}'s Rank`)
      .setThumbnail(interaction.user.displayAvatarURL())
      .setColor('#7289da')
      .addFields(
        { name: 'Level', value: `${profile.level}`, inline: true },
        { name: 'XP', value: `${profile.xp} / ${xpNeeded}`, inline: true },
        { name: 'Coins', value: `${profile.coins}`, inline: true },
      )
      .setFooter({ text: 'Keep chatting to earn more XP!' });

    return interaction.reply({ embeds: [embed] });
  }
}
