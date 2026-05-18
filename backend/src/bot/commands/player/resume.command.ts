import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

@Injectable()
export class ResumeCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'resume',
    description: 'Resume the paused music',
  })
  @UseGuards(PlayerGuard)
  public async onResume(@Context() [interaction]: SlashCommandContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    const currentTrack = player.queue.current;
    await player.resume();

    const embed = new EmbedBuilder()
      .setTitle('✦ Music Resumed')
      .setColor('#2B2D31')
      .setFooter({ text: `Resumed by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() || undefined });

    if (currentTrack) {
      embed.setDescription(`▶️ **Resumed:** [${currentTrack.info.title}](${currentTrack.info.uri})`);
      embed.setThumbnail(currentTrack.info.artworkUrl || null);
    } else {
      embed.setDescription('Playback has been resumed.');
    }

    return interaction.reply({ embeds: [embed] });
  }
}
