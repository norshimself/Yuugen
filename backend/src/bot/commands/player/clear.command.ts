import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

@Injectable()
export class ClearCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'clear',
    description: 'Clear all songs from the queue',
  })
  @UseGuards(PlayerGuard)
  public async onClear(@Context() [interaction]: SlashCommandContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    const queueLength = player.queue.tracks.length;
    await player.queue.splice(0, player.queue.tracks.length);

    const embed = new EmbedBuilder()
      .setTitle('✦ Queue Cleared')
      .setColor('#2B2D31')
      .setFooter({ text: `Cleared by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() || undefined });

    if (queueLength > 0) {
      embed.setDescription(`🗑️ Removed \`${queueLength}\` tracks from the queue.`);
    } else {
      embed.setDescription('The queue is already empty.');
    }

    return interaction.reply({ embeds: [embed] });
  }
}
