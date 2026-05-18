import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

@Injectable()
export class StopCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'stop',
    description: 'Stop playback and leave voice channel',
  })
  @UseGuards(PlayerGuard)
  public async onStop(@Context() [interaction]: SlashCommandContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    const currentTrack = player.queue.current;
    const queueLength = player.queue.tracks.length;
    await player.destroy();

    const embed = new EmbedBuilder()
      .setTitle('✦ Playback Stopped')
      .setColor('#2B2D31')
      .setFooter({ text: `Stopped by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() || undefined });

    let description = 'Left the voice channel.\n\n';
    if (currentTrack) {
      description += `⏹️ **Stopped:** [${currentTrack.info.title}](${currentTrack.info.uri})\n`;
    }
    if (queueLength > 0) {
      description += `🗑️ **Cleared:** \`${queueLength}\` tracks from the queue.`;
    }

    embed.setDescription(description);

    return interaction.reply({ embeds: [embed] });
  }
}
