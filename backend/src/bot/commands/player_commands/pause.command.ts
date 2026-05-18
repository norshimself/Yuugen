import { Injectable } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';

@Injectable()
export class PauseCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'pause',
    description: 'Pause the current song',
  })
  public async onPause(@Context() [interaction]: SlashCommandContext) {
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

