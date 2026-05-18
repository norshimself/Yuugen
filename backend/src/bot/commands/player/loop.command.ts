import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand, Options, StringOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

class LoopOptions {
  @StringOption({
    name: 'mode',
    description: 'The loop mode (off, track, queue)',
    required: true,
  })
  mode: string;
}

@Injectable()
export class LoopCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'loop',
    description: 'Set the loop mode',
  })
  @UseGuards(PlayerGuard)
  public async onLoop(
    @Context() [interaction]: SlashCommandContext,
    @Options() { mode }: LoopOptions,
  ) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

    const validModes = ['off', 'track', 'queue'];
    
    if (!validModes.includes(mode.toLowerCase())) {
      return interaction.reply({
        content: 'Invalid mode! Please use one of: off, track, queue',
        ephemeral: true,
      });
    }

    await player.setRepeatMode(mode.toLowerCase() as any);

    const embed = new EmbedBuilder()
      .setTitle('✦ Loop Mode Updated')
      .setColor('#2B2D31')
      .setFooter({ text: `Updated by ${interaction.user.username}`, iconURL: interaction.user.displayAvatarURL() || undefined });

    let description = `🔁 Loop mode is now set to **\`${mode.toLowerCase()}\`**.\n\n`;
    const currentTrack = player.queue.current;
    
    if (mode.toLowerCase() === 'track' && currentTrack) {
      description += `**Looping Track:** [${currentTrack.info.title}](${currentTrack.info.uri})`;
      embed.setThumbnail(currentTrack.info.artworkUrl || null);
    } else if (mode.toLowerCase() === 'queue') {
      description += `**Looping Queue:** \`${player.queue.tracks.length + (currentTrack ? 1 : 0)}\` tracks`;
    }
    
    embed.setDescription(description);

    return interaction.reply({ embeds: [embed] });
  }
}
