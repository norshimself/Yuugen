import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, Options, StringOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';

class PlayOptions {
  @StringOption({
    name: 'query',
    description: 'The song or URL to play',
    required: true,
  })
  query: string;
}

@Injectable()
export class PlayCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'play',
    description: 'Play a song from YouTube',
  })
  public async onPlay(
    @Context() [interaction]: SlashCommandContext,
    @Options() { query }: PlayOptions,
  ) {
    const member = interaction.member as any;
    const voiceChannelId = member.voice.channelId;

    if (!voiceChannelId) {
      return interaction.reply({
        content: 'You must be in a voice channel!',
        ephemeral: true,
      });
    }

    if (!interaction.guildId) {
      return interaction.reply({
        content: 'This command can only be used in a guild!',
        ephemeral: true,
      });
    }

    // Create or get player
    const player = this.lavalinkManager.createPlayer({
      guildId: interaction.guildId,
      voiceChannelId: voiceChannelId,
      textChannelId: interaction.channelId,
      selfDeaf: true,
    });

    if (!player.connected) {
      await player.connect();
    }

    await interaction.deferReply();

    try {
      const result = await player.search({ query }, interaction.user);

      if (!result.tracks.length) {
        return interaction.editReply({ content: 'No tracks found!' });
      }

      const track = result.tracks[0];
      player.queue.add(track);

      // Calculate estimated time and position
      const queuePosition = player.queue.tracks.length;
      let estimatedTimeMs = 0;

      if (player.playing && player.queue.current) {
        estimatedTimeMs +=
          (player.queue.current.info.duration || 0) - player.position;
      }

      for (let i = 0; i < queuePosition - 1; i++) {
        estimatedTimeMs += player.queue.tracks[i].info.duration || 0;
      }

      const isPlayingNow = queuePosition === 0 && !player.playing;

      if (!player.playing) {
        await player.play();
      }

      const embed = new EmbedBuilder()
        .setTitle(isPlayingNow ? '✦ Playing Now' : '✦ Added to Queue')
        .setDescription(
          `**[${track.info.title}](${track.info.uri})**\n\n` +
            (isPlayingNow
              ? ''
              : `**Position in Queue:** \`#${queuePosition}\`\n**Estimated Time:** \`${this.formatDuration(estimatedTimeMs)}\`\n`),
        )
        .setThumbnail(track.info.artworkUrl || null)
        .addFields(
          {
            name: 'Duration',
            value: track.info.isStream
              ? '🔴 LIVE'
              : `\`${this.formatDuration(track.info.duration || 0)}\``,
            inline: true,
          },
          {
            name: 'Author',
            value: track.info.author || 'Unknown',
            inline: true,
          },
          {
            name: 'Source',
            value: track.info.sourceName || 'Unknown',
            inline: true,
          },
        )
        .setColor('#2B2D31') // Sleek dark theme
        .setFooter({
          text: `Added by ${interaction.user.username}`,
          iconURL: interaction.user.displayAvatarURL() || undefined,
        });

      return interaction.editReply({ embeds: [embed] });
    } catch (error) {
      console.error(error);
      return interaction.editReply({
        content: 'An error occurred while searching for the track.',
      });
    }
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);

    const hoursStr = hours > 0 ? `${hours}:` : '';
    const minutesStr =
      minutes < 10 && hours > 0 ? `0${minutes}:` : `${minutes}:`;
    const secondsStr = seconds < 10 ? `0${seconds}` : `${seconds}`;

    return `${hoursStr}${minutesStr}${secondsStr}`;
  }
}
