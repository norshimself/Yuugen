import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

@Injectable()
export class LyricsCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'lyrics',
    description: 'Get lyrics for the current song',
  })
  @UseGuards(PlayerGuard)
  public async onLyrics(@Context() [interaction]: SlashCommandContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    if (!player.queue.current) {
      return interaction.reply({
        content: 'No music is playing!',
        ephemeral: true,
      });
    }

    await interaction.deferReply();

    try {
      // Check if getCurrentLyrics method exists
      if (typeof player.getCurrentLyrics !== 'function') {
        return interaction.editReply({
          content: 'Lyrics feature is not supported by this version of the client or node.',
        });
      }

      const lyrics = await player.getCurrentLyrics();

      if (!lyrics || !lyrics.text) {
        return interaction.editReply({
          content: 'No lyrics found for this song.',
        });
      }

      const embed = new EmbedBuilder()
        .setTitle(`✦ Lyrics for ${player.queue.current.info.title}`)
        .setDescription(lyrics.text.slice(0, 4096)) // Discord limit is 4096
        .setColor('#2B2D31');

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      return interaction.editReply({
        content: 'An error occurred while fetching lyrics.',
      });
    }
  }
}
