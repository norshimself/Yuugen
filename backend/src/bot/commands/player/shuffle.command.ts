import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

@Injectable()
export class ShuffleCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'shuffle',
    description: 'Shuffle the queue',
  })
  @UseGuards(PlayerGuard)
  public async onShuffle(@Context() [interaction]: SlashCommandContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    const queueLength = player.queue.tracks.length;
    await player.queue.shuffle();

    const embed = new EmbedBuilder()
      .setTitle('✦ Queue Shuffled')
      .setColor('#2B2D31')
      .setFooter({ text: `Shuffled by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() || undefined });

    if (queueLength > 0) {
      embed.setDescription(`🔀 Shuffled \`${queueLength}\` tracks in the queue.`);
    } else {
      embed.setDescription('The queue is empty, nothing to shuffle.');
    }

    return interaction.reply({ embeds: [embed] });
  }
}
