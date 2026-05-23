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

      if (result.loadType === 'playlist' && result.playlist) {
        const playlist = result.playlist;
        const playlistId = 'pl_' + Date.now() + '_' + Math.random().toString(36).substring(2, 9);
        
        const tracksToAdd = result.tracks.map(t => {
          t.userData = {
            ...t.userData,
            playlist: {
              id: playlistId,
              name: playlist.name,
              uri: playlist.uri || '',
            }
          };
          return t;
        });

        const finalTracks = tracksToAdd.slice(0, 100);
        
        // Calculate estimated wait time before adding them
        const queuePositionBefore = player.queue.tracks.length + 1;
        let estimatedTimeMs = 0;

        if (player.playing && player.queue.current) {
          estimatedTimeMs += (player.queue.current.info.duration || 0) - player.position;
        }

        for (let i = 0; i < player.queue.tracks.length; i++) {
          estimatedTimeMs += player.queue.tracks[i].info.duration || 0;
        }

        player.queue.add(finalTracks);

        const isPlayingNow = !player.playing;

        if (!player.playing) {
          await player.play();
        }

        const embed = new EmbedBuilder()
          .setTitle(isPlayingNow ? '✦ Playlist Playing Now' : '✦ Playlist Added to Queue')
          .setDescription(playlist.uri ? `**[${playlist.name}](${playlist.uri})**` : `**${playlist.name}**`)
          .setThumbnail(playlist.thumbnail || finalTracks[0]?.info.artworkUrl || null)
          .addFields(
            {
              name: 'Tracks Count',
              value: `\`${finalTracks.length} songs\`${result.tracks.length > 100 ? ' (capped at 100)' : ''}`,
              inline: true,
            },
            {
              name: 'Total Duration',
              value: `\`${this.formatDuration(playlist.duration || 0)}\``,
              inline: true,
            },
            {
              name: 'First Song',
              value: finalTracks[0] 
                ? (finalTracks[0].info.uri ? `[${finalTracks[0].info.title}](${finalTracks[0].info.uri})` : finalTracks[0].info.title)
                : 'Unknown',
              inline: false,
            }
          )
          .setColor('#2B2D31')
          .setFooter({
            text: `Added by ${interaction.user.username}`,
            iconURL: interaction.user.displayAvatarURL() || undefined,
          });

        if (!isPlayingNow) {
          embed.addFields(
            {
              name: 'Position in Queue',
              value: `\`#${queuePositionBefore}\``,
              inline: true,
            },
            {
              name: 'Estimated Wait',
              value: `\`${this.formatDuration(estimatedTimeMs)}\``,
              inline: true,
            }
          );
        }

        return interaction.editReply({ embeds: [embed] });
      }

      const track = result.tracks[0];
      
      // Calculate estimated time and position before adding
      const queuePosition = player.queue.tracks.length + 1;
      let estimatedTimeMs = 0;

      if (player.playing && player.queue.current) {
        estimatedTimeMs +=
          (player.queue.current.info.duration || 0) - player.position;
      }

      for (let i = 0; i < player.queue.tracks.length; i++) {
        estimatedTimeMs += player.queue.tracks[i].info.duration || 0;
      }

      player.queue.add(track);

      const isPlayingNow = !player.playing;

      if (!player.playing) {
        await player.play();
      }

      const embed = new EmbedBuilder()
        .setTitle(isPlayingNow ? '✦ Playing Now' : '✦ Added to Queue')
        .setDescription(
          (track.info.uri ? `**[${track.info.title}](${track.info.uri})**\n\n` : `**${track.info.title}**\n\n`) +
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
