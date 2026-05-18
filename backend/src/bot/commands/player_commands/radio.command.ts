import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, Options, StringOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, ComponentType } from 'discord.js';

class RadioOptions {
  @StringOption({
    name: 'query',
    description: 'Station name or genre (e.g., lofi, jazz)',
    required: true,
  })
  query: string;

  @StringOption({
    name: 'country',
    description: 'Filter by country (e.g., Morocco, France)',
    required: false,
  })
  country?: string;
}

@Injectable()
export class RadioCommand {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  @SlashCommand({
    name: 'radio',
    description: 'Search and play a live radio station',
  })
  public async onRadio(
    @Context() [interaction]: SlashCommandContext,
    @Options() { query, country }: RadioOptions,
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

    await interaction.deferReply();

    try {
      // Search for top 5 radio stations using Radio Browser API
      let url = `https://de1.api.radio-browser.info/json/stations/search?name=${encodeURIComponent(query)}&limit=5&order=votes`;
      
      if (country) {
        if (country.length === 2) {
          url += `&countrycode=${encodeURIComponent(country.toUpperCase())}`;
        } else {
          // Capitalize first letter of each word for the country name
          const capitalizedCountry = country
            .split(' ')
            .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
            .join(' ');
          url += `&country=${encodeURIComponent(capitalizedCountry)}`;
        }
      }

      const response = await fetch(url);
      const stations = await response.json() as any[];

      if (!stations || stations.length === 0) {
        return interaction.editReply({ content: 'No radio stations found!' });
      }

      // Build list for embed
      const listText = stations.map((s, i) => `${i + 1}. **${s.name}** (${s.country || 'Unknown'})`).join('\n');

      const embed = new EmbedBuilder()
        .setTitle('✦ Radio Search Results')
        .setDescription(`Select a station to play:\n\n${listText}`)
        .setColor('#2B2D31');

      // Create buttons
      const row = new ActionRowBuilder<ButtonBuilder>();
      
      stations.forEach((s, i) => {
        row.addComponents(
          new ButtonBuilder()
            .setCustomId(`radio_select_${i}`)
            .setLabel(`${i + 1}`)
            .setStyle(ButtonStyle.Primary)
        );
      });

      const message = await interaction.editReply({ embeds: [embed], components: [row] });

      // Wait for user to select a button
      try {
        const confirmation = await message.awaitMessageComponent({
          componentType: ComponentType.Button,
          time: 30000, // 30 seconds
          filter: (i) => i.user.id === interaction.user.id,
        });

        const selectedIndex = parseInt(confirmation.customId.split('_')[2]);
        const selectedStation = stations[selectedIndex];
        const streamUrl = selectedStation.url_resolved || selectedStation.url;

        // Acknowledge the button click
        await confirmation.deferUpdate();

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

        // Search for the stream URL in Lavalink
        const result = await player.search({ query: streamUrl }, interaction.user);

        if (!result.tracks.length) {
          return interaction.editReply({ content: 'Could not resolve the radio stream!', components: [] });
        }

        const track = result.tracks[0];
        track.info.title = selectedStation.name;
        track.info.author = selectedStation.tags || 'Radio Station';
        track.info.isStream = true;

        player.queue.add(track);

        if (!player.playing) {
          await player.play();
        }

        const playEmbed = new EmbedBuilder()
          .setTitle('✦ Playing Radio')
          .setDescription(`**[${selectedStation.name}](${selectedStation.homepage || streamUrl})**`)
          .setThumbnail(selectedStation.favicon || null)
          .addFields(
            { name: 'Country', value: selectedStation.country || 'Unknown', inline: true },
            { name: 'Status', value: '🔴 LIVE', inline: true },
            { name: 'Tags', value: selectedStation.tags || 'None', inline: false }
          )
          .setColor('#2B2D31');

        return interaction.editReply({ embeds: [playEmbed], components: [] });

      } catch (e) {
        // Timeout
        return interaction.editReply({ content: 'Selection timed out.', components: [] });
      }

    } catch (error) {
      console.error(error);
      return interaction.editReply({
        content: 'An error occurred while searching for the radio station.',
        components: [],
      });
    }
  }
}


