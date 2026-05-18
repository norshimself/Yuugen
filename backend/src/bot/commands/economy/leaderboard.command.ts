import { Injectable } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { EmbedBuilder } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

@Injectable()
export class LeaderboardCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'leaderboard',
    description: 'View the top 10 most active users.',
  })
  public async onLeaderboard(@Context() [interaction]: SlashCommandContext) {
    const topUsers = await this.economyService.getLeaderboard(10);
    
    const embed = new EmbedBuilder()
      .setTitle('🏆 Economy Leaderboard')
      .setColor('#f1c40f');

    if (topUsers.length === 0) {
      embed.setDescription('No data yet. Start chatting to appear here!');
    } else {
      const list = topUsers.map((user, index) => {
        let medal = '';
        if (index === 0) medal = '🥇 ';
        else if (index === 1) medal = '🥈 ';
        else if (index === 2) medal = '🥉 ';
        else medal = `**#${index + 1}** `;
        
        return `${medal}<@${user.userId}> - Level ${user.level} (${user.xp} XP)`;
      }).join('\n');
      
      embed.setDescription(list);
    }

    return interaction.reply({ embeds: [embed] });
  }
}
