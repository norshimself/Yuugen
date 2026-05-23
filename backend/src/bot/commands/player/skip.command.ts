import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

@Injectable()
export class SkipCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'skip',
    description: 'Skip the current song',
  })
  @UseGuards(PlayerGuard)
  public async onSkip(@Context() [interaction]: SlashCommandContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    await interaction.deferReply();

    const skippedTrack = player.queue.current;
    await player.skip(1, false);

    setTimeout(async () => {
      const nextTrack = player.queue.current;

      const embed = new EmbedBuilder()
        .setTitle('✦ Track Skipped')
        .setColor('#2B2D31')
        .setFooter({
          text: `Skipped by ${interaction.user.username}`,
          iconURL: interaction.user.displayAvatarURL() || undefined,
        });

      let description = '';
      if (skippedTrack) {
        description += `⏭️ **Skipped:** [${skippedTrack.info.title}](${skippedTrack.info.uri})\n\n`;
      }

      if (nextTrack) {
        description += `🎶 **Now Playing:** [${nextTrack.info.title}](${nextTrack.info.uri})`;
        embed.setThumbnail(nextTrack.info.artworkUrl || null);
      } else {
        description += `*The queue is now empty.*`;
      }

      embed.setDescription(description);

      return interaction.editReply({ embeds: [embed] });
    }, 500);
  }
}
