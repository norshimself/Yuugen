import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand, Options, IntegerOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

class SeekOptions {
  @IntegerOption({
    name: 'seconds',
    description: 'The position to seek to in seconds',
    required: true,
  })
  seconds: number;
}

@Injectable()
export class SeekCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'seek',
    description: 'Seek to a specific position in the current song',
  })
  @UseGuards(PlayerGuard)
  public async onSeek(
    @Context() [interaction]: SlashCommandContext,
    @Options() { seconds }: SeekOptions,
  ) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    const currentTrack = player.queue.current;

    if (!currentTrack) {
      return interaction.reply({
        content: 'No track is currently playing!',
        ephemeral: true,
      });
    }

    if (seconds < 0 || seconds * 1000 > (currentTrack.info.duration || 0)) {
      return interaction.reply({
        content: 'Invalid seek position!',
        ephemeral: true,
      });
    }

    await player.seek(seconds * 1000);

    const embed = new EmbedBuilder()
      .setTitle('✦ Seeked')
      .setColor('#2B2D31')
      .setFooter({
        text: `Seeked by ${interaction.user.username}`,
        iconURL: interaction.user.displayAvatarURL() || undefined,
      });

    embed.setDescription(
      `⏩ **Jumped to:** \`${seconds}s\`\n\n` +
        `**Currently Playing:** [${currentTrack.info.title}](${currentTrack.info.uri})`,
    );
    embed.setThumbnail(currentTrack.info.artworkUrl || null);

    return interaction.reply({ embeds: [embed] });
  }
}
