import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

@Injectable()
export class QueueCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'queue',
    description: 'Displays the current music queue',
  })
  @UseGuards(PlayerGuard)
  public async onQueue(@Context() [interaction]: SlashCommandContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    const currentTrack = player.queue.current;
    const tracks = player.queue.tracks;

    if (!currentTrack && !tracks.length) {
      return interaction.reply('The queue is currently empty.');
    }

    const embed = new EmbedBuilder()
      .setTitle('✦ Current Queue')
      .setColor('#2B2D31');

    let description = '';

    if (currentTrack) {
      description += `**Currently Playing:**\n[${currentTrack.info.title}](${currentTrack.info.uri})\n\n`;
    }

    description += `**Up Next:**\n`;

    if (tracks.length > 0) {
      const queueList = tracks
        .map((track, index) => `\`${index + 1}.\` [${track.info.title}](${track.info.uri})`)
        .slice(0, 10)
        .join('\n');
      
      description += queueList;
      
      if (tracks.length > 10) {
        embed.setFooter({ text: `...and ${tracks.length - 10} more tracks.` });
      }
    } else {
      description += '*No more tracks in queue.*';
    }

    embed.setDescription(description);

    return interaction.reply({ embeds: [embed] });
  }
}
