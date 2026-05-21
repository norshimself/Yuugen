import { Injectable, UseGuards } from '@nestjs/common';
import { Context, SlashCommand, Options, StringOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder } from 'discord.js';
import { PlayerGuard } from '../../../shared/guards/player.guard';

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
      { name: 'Bass Boost (High-Impact EQ)', value: 'bassboost' },
      { name: 'Space Reverb (Environmental)', value: 'reverb' },
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
  @UseGuards(PlayerGuard)
  public async onFilter(
    @Context() [interaction]: SlashCommandContext,
    @Options() { type }: FilterOptions,
  ) {
    const player = this.lavalinkManager.players.get(interaction.guildId!)!;

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
      case 'bassboost': {
        const isEqActive = player.filterManager.equalizerBands && player.filterManager.equalizerBands.length > 0 && player.filterManager.equalizerBands.some(band => band.gain !== 0);
        if (isEqActive) {
          await player.filterManager.clearEQ();
        } else {
          await player.filterManager.setEQPreset('BassboostHigh');
        }
        break;
      }
      case 'reverb':
        await player.filterManager.lavalinkFilterPlugin.toggleReverb();
        break;
      case 'clear':
        await player.filterManager.resetFilters();
        await player.filterManager.clearEQ();
        if (player.filterManager.filters.lavalinkFilterPlugin?.reverb) {
          await player.filterManager.lavalinkFilterPlugin.toggleReverb();
        }
        break;
    }

    const embed = new EmbedBuilder()
      .setTitle('✦ Audio Filter Applied')
      .setDescription(type === 'clear' ? 'All filters have been cleared.' : `Toggled the **${type}** filter!`)
      .setColor('#2B2D31')
      .setFooter({ text: 'Note: Filters may take a few seconds to apply.' });

    return interaction.editReply({ embeds: [embed] });
  }
}
