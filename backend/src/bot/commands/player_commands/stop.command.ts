import { Injectable } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';

@Injectable()
export class StopCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'stop',
    description: 'Stop playback and leave voice channel',
  })
  public async onStop(@Context() [interaction]: SlashCommandContext) {
    if (!interaction.guildId) {
      return interaction.reply({
        content: 'This command can only be used in a guild!',
        ephemeral: true,
      });
    }

    const player = this.lavalinkManager.players.get(interaction.guildId);

    if (!player) {
      return interaction.reply({
        content: 'No music is playing!',
        ephemeral: true,
      });
    }

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

