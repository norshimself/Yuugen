import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand, Button } from 'necord';
import type { SlashCommandContext, ButtonContext } from 'necord';
import { LavalinkManager, Player } from 'lavalink-client';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

@Injectable()
@UseGuards(PlayerGuard)
export class NowPlayingCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'nowplaying',
    description: 'Show details about the current playing song',
  })
  public async onNowPlaying(@Context() [interaction]: SlashCommandContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    if (!player.queue.current) {
      return interaction.reply({
        content: 'No music is playing!',
        ephemeral: true,
      });
    }

    const embed = this.createNowPlayingEmbed(player);
    const row = this.createNowPlayingButtons();

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  @Button('np-pause')
  public async onPause(@Context() [interaction]: ButtonContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    if (player.paused) {
      await player.resume();
    } else {
      await player.pause();
    }

    const embed = this.createNowPlayingEmbed(player);
    return interaction.update({ embeds: [embed] });
  }

  @Button('np-skip')
  public async onSkip(@Context() [interaction]: ButtonContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    await player.skip();
    
    setTimeout(async () => {
      if (!player.queue.current) {
        return interaction.update({ content: 'Queue ended.', embeds: [], components: [] });
      }
      const embed = this.createNowPlayingEmbed(player);
      return interaction.update({ embeds: [embed] });
    }, 500);
  }

  @Button('np-stop')
  public async onStop(@Context() [interaction]: ButtonContext) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    await player.destroy();
    return interaction.update({ content: '🛑 Playback stopped and left the channel.', embeds: [], components: [] });
  }

  private createNowPlayingEmbed(player: Player): EmbedBuilder {
    const track = player.queue.current!;
    const position = player.position;
    const duration = track.info.duration || 0;

    return new EmbedBuilder()
      .setTitle('🎶 Now Playing')
      .setDescription(`[${track.info.title}](${track.info.uri})`)
      .setThumbnail(track.info.artworkUrl || null)
      .addFields(
        { name: 'Author', value: track.info.author || 'Unknown', inline: true },
        { name: 'Progress', value: track.info.isStream ? '🔴 LIVE' : `\`${this.formatDuration(position)}\` / \`${this.formatDuration(duration)}\``, inline: true },
        { name: 'Progress Bar', value: track.info.isStream ? '▬'.repeat(14) + '🔴' : this.createProgressBar(position, duration), inline: false }
      )
      .setColor('#2B2D31');
  }

  private createNowPlayingButtons(): ActionRowBuilder<ButtonBuilder> {
    return new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('np-pause')
        .setLabel('⏯️ Pause/Resume')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('np-skip')
        .setLabel('⏭️ Skip')
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId('np-stop')
        .setLabel('🛑 Stop')
        .setStyle(ButtonStyle.Secondary)
    );
  }

  private formatDuration(ms: number): string {
    const seconds = Math.floor((ms / 1000) % 60);
    const minutes = Math.floor((ms / (1000 * 60)) % 60);
    const hours = Math.floor((ms / (1000 * 60 * 60)) % 24);

    const hoursStr = hours > 0 ? `${hours}:` : '';
    const minutesStr = minutes < 10 && hours > 0 ? `0${minutes}:` : `${minutes}:`;
    const secondsStr = seconds < 10 ? `0${seconds}` : `${seconds}`;

    return `${hoursStr}${minutesStr}${secondsStr}`;
  }

  private createProgressBar(current: number, total: number, size: number = 15): string {
    if (total === 0) return '🔘' + '▬'.repeat(size - 1);
    const progress = Math.round((size * current) / total);
    const emptyProgress = size - progress;

    const progressText = '▬'.repeat(progress);
    const emptyProgressText = '▬'.repeat(emptyProgress);

    const bar = progressText + '🔘' + emptyProgressText;
    
    return bar;
  }
}
