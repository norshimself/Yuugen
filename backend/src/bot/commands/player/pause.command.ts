import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

@Injectable()
export class PauseCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'pause',
    description: 'Pause the current song',
  })
  @UseGuards(PlayerGuard)
  public async onPause(@Context() [interaction]: SlashCommandContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    const currentTrack = player.queue.current;
    await player.pause();

    const embed = new EmbedBuilder()
      .setTitle('✦ Music Paused')
      .setColor('#2B2D31')
      .setFooter({ text: `Paused by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() || undefined });

    if (currentTrack) {
      embed.setDescription(`⏸️ **Paused:** [${currentTrack.info.title}](${currentTrack.info.uri})`);
      embed.setThumbnail(currentTrack.info.artworkUrl || null);
    } else {
      embed.setDescription('Playback has been paused.');
    }

    return interaction.reply({ embeds: [embed] });
  }
}
