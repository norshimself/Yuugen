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
      .setDescription('Choose your weapon!')
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

  private async handleRps(interaction: any, userChoice: string) {
    const choices = ['rock', 'paper', 'scissors'];
    const botChoice = choices[Math.floor(Math.random() * choices.length)];

    let result = '';
    let won = false;
    let tie = false;

    if (userChoice === botChoice) {
      result = `It's a tie! We both chose **${userChoice}**.`;
      tie = true;
    } else if (
      (userChoice === 'rock' && botChoice === 'scissors') ||
      (userChoice === 'paper' && botChoice === 'rock') ||
      (userChoice === 'scissors' && botChoice === 'paper')
    ) {
      result = `You won! Your **${userChoice}** beats my **${botChoice}**!`;
      won = true;
    } else {
      result = `You lost! My **${botChoice}** beats your **${userChoice}**!`;
    }

    const reward = 20;

    const embed = new EmbedBuilder()
      .setTitle('✊ Rock Paper Scissors Results ✋')
      .setTimestamp();

    if (won) {
      await this.economyService.addCoins(interaction.user.id, reward);
      embed
        .setColor('#2ecc71')
        .setDescription(`${result}\nYou earned **${reward}** coins!`);
    } else if (tie) {
      embed.setColor('#f1c40f').setDescription(result);
    } else {
      embed.setColor('#e74c3c').setDescription(result);
    }

    return interaction.update({ embeds: [embed], components: [] });
  }
}
