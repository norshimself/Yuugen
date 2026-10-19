import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, Button } from 'necord';
import type { SlashCommandContext, ButtonContext } from 'necord';
import {
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
} from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

@Injectable()
export class RpsCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'rps',
    description: 'Play Rock Paper Scissors against the bot!',
  })
  public async onRps(@Context() [interaction]: SlashCommandContext) {
    const embed = new EmbedBuilder()
      .setColor('#f1c40f')
      .setTitle('✊ Rock Paper Scissors ✋')
      .setDescription('Choose your weapon! One rewarded round per minute.')
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
      new ButtonBuilder()
        .setCustomId('rps-rock')
        .setLabel('Rock')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✊'),
      new ButtonBuilder()
        .setCustomId('rps-paper')
        .setLabel('Paper')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✋'),
      new ButtonBuilder()
        .setCustomId('rps-scissors')
        .setLabel('Scissors')
        .setStyle(ButtonStyle.Primary)
        .setEmoji('✌️'),
    );

    return interaction.reply({ embeds: [embed], components: [row] });
  }

  @Button('rps-rock')
  public async onRock(@Context() [interaction]: ButtonContext) {
    return this.handleRps(interaction, 'rock');
  }

  @Button('rps-paper')
  public async onPaper(@Context() [interaction]: ButtonContext) {
    return this.handleRps(interaction, 'paper');
  }

  @Button('rps-scissors')
  public async onScissors(@Context() [interaction]: ButtonContext) {
    return this.handleRps(interaction, 'scissors');
  }

  private async handleRps(
    interaction: any,
    userChoice: 'rock' | 'paper' | 'scissors',
  ) {
    const game = await this.economyService.playRps(
      interaction.user.id,
      userChoice,
    );
    if (!game.success) {
      const retryAt = game.nextPlay
        ? ` Try again <t:${Math.floor(game.nextPlay.getTime() / 1000)}:R>.`
        : '';
      return interaction.reply({
        content: `Rock Paper Scissors is on cooldown.${retryAt}`,
        ephemeral: true,
      });
    }

    const result = game.result === 'tie'
      ? `It's a tie! We both chose **${userChoice}**.`
      : game.result === 'win'
        ? `You won! Your **${userChoice}** beats my **${game.botChoice}**!`
        : `You lost! My **${game.botChoice}** beats your **${userChoice}**!`;

    const embed = new EmbedBuilder()
      .setTitle('✊ Rock Paper Scissors Results ✋')
      .setColor(game.result === 'win' ? '#2ecc71'
        : game.result === 'tie' ? '#f1c40f' : '#e74c3c')
      .setDescription(
        game.reward > 0
          ? `${result}\nYou earned **${game.reward}** coins!`
          : result,
      )
      .setTimestamp();

    return interaction.update({ embeds: [embed], components: [] });
  }
}
