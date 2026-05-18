import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, Options, StringOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';

class FilterOptions {
  @StringOption({
    name: 'type',
    description: 'The audio filter to apply',
    required: true,
    choices: [
      { name: 'Nightcore (Speed up & Pitch up)', value: 'nightcore' },
      { name: 'Vaporwave (Slow down)', value: 'vaporwave' },
      { name: '8D Audio (Rotation)', value: '8d' },
      { name: 'Karaoke (Remove Vocals)', value: 'karaoke' },
      { name: 'Tremolo', value: 'tremolo' },
      { name: 'Vibrato', value: 'vibrato' },
      { name: 'Low Pass (Muffled)', value: 'lowpass' },
      { name: 'Clear All Filters', value: 'clear' },
    ],
  })
  type: string;
}

@Injectable()
export class FilterCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'filter',
    description: 'Apply premium audio filters to the music',
  })
  public async onFilter(
    @Context() [interaction]: SlashCommandContext,
    @Options() { type }: FilterOptions,
  ) {
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

    await interaction.deferReply();

    // Apply filters based on selection
    switch (type) {
      case 'nightcore':
        await player.filterManager.toggleNightcore();
        break;
      case 'vaporwave':
        await player.filterManager.toggleVaporwave();
        break;
      case '8d':
        await player.filterManager.toggleRotation();
        break;
      case 'karaoke':
        await player.filterManager.toggleKaraoke();
        break;
      case 'tremolo':
        await player.filterManager.toggleTremolo();
        break;
      case 'vibrato':
        await player.filterManager.toggleVibrato();
        break;
      case 'lowpass':
        await player.filterManager.toggleLowPass();
        break;
      case 'clear':
        await player.filterManager.resetFilters();
        break;
    }

    const embed = new EmbedBuilder()
      .setTitle('✦ Audio Filter Applied')
      .setDescription(type === 'clear' ? 'All filters have been cleared.' : `Toggled the **${type}** filter!`)
      .setColor('#2B2D31') // Sleek dark theme
      .setFooter({ text: 'Note: Filters may take a few seconds to apply.' });

    return interaction.editReply({ embeds: [embed] });
  }
}
