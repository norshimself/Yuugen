import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand, Options, IntegerOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

class RemoveOptions {
  @IntegerOption({
    name: 'index',
    description: 'The index of the song to remove (1-based)',
    required: true,
  })
  index: number;
}

@Injectable()
export class RemoveCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'remove',
    description: 'Remove a specific song from the queue',
  })
  @UseGuards(PlayerGuard)
  public async onRemove(
    @Context() [interaction]: SlashCommandContext,
    @Options() { index }: RemoveOptions,
  ) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    const tracks = player.queue.tracks;

    if (index < 1 || index > tracks.length) {
      return interaction.reply({
        content: `Invalid index! Please provide a number between 1 and ${tracks.length}.`,
        ephemeral: true,
      });
    }

    const removedTrack = tracks[index - 1];
    await player.queue.splice(index - 1, 1);
    const queueLength = player.queue.tracks.length;

    const embed = new EmbedBuilder()
      .setTitle('✦ Track Removed')
      .setColor('#2B2D31')
      .setFooter({ text: `Removed by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() || undefined });

    embed.setDescription(
      `🗑️ **Removed:** [${removedTrack.info.title}](${removedTrack.info.uri})\n` +
      `**Remaining Tracks:** \`${queueLength}\``
    );

    return interaction.reply({ embeds: [embed] });
  }
}
