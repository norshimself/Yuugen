import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand, Options, IntegerOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

class VolumeOptions {
  @IntegerOption({
    name: 'level',
    description: 'Volume level (0-100)',
    required: true,
  })
  level: number;
}

@Injectable()
export class VolumeCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'volume',
    description: 'Set the volume of the playback',
  })
  @UseGuards(PlayerGuard)
  public async onVolume(
    @Context() [interaction]: SlashCommandContext,
    @Options() { level }: VolumeOptions,
  ) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    if (level < 0 || level > 100) {
      return interaction.reply({
        content: 'Volume must be between 0 and 100!',
        ephemeral: true,
      });
    }

    const currentTrack = player.queue.current;
    await player.setVolume(level);

    const embed = new EmbedBuilder()
      .setTitle('✦ Volume Updated')
      .setColor('#2B2D31')
      .setFooter({ text: `Volume updated by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() || undefined });

    let description = `🔊 Volume set to \`${level}%\`\n${this.createProgressBar(level, 100)}\n\n`;
    if (currentTrack) {
      description += `**Currently Playing:** [${currentTrack.info.title}](${currentTrack.info.uri})`;
      embed.setThumbnail(currentTrack.info.artworkUrl || null);
    }
    embed.setDescription(description);

    return interaction.reply({ embeds: [embed] });
  }

  private createProgressBar(current: number, total: number, size: number = 10): string {
    const progress = Math.round((size * current) / total);
    const emptyProgress = size - progress;

    const progressText = '█'.repeat(progress);
    const emptyProgressText = '░'.repeat(emptyProgress);

    return `\`[${progressText}${emptyProgressText}]\``;
  }
}
