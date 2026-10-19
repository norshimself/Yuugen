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
export class TriviaCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'trivia',
    description: 'Answer a trivia question to win coins!',
  })
  public async onTrivia(@Context() [interaction]: SlashCommandContext) {
    await interaction.deferReply();
    const game = await this.economyService.getOrStartTrivia(
      interaction.user.id,
    );

    if (!game.success || !game.question || !game.options) {
      return interaction.editReply({
        content: game.message || 'Unable to start trivia right now.',
      });
    }

    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('🧠 Trivia Time!')
      .setDescription(game.question)
      .setFooter({
        text: `Reward: ${game.reward} coins • Question expires in 15 minutes`,
      })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>();
    game.options.forEach((option, index) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`trivia-${index}`)
          .setLabel(option.slice(0, 80))
          .setStyle(ButtonStyle.Primary),
      );
    });

    const prompt = await interaction.editReply({
      embeds: [embed],
      components: [row],
    });
    // Bind the Discord message ID in the database before it is eligible for
    // rewards. An old button from a previous prompt can never answer it.
    await this.economyService.bindTriviaMessage(
      interaction.user.id,
      prompt.id,
    );
  }

  @Button('trivia-0')
  public async onAnswer0(@Context() [interaction]: ButtonContext) {
    return this.handleAnswer(interaction, 0);
  }

  @Button('trivia-1')
  public async onAnswer1(@Context() [interaction]: ButtonContext) {
    return this.handleAnswer(interaction, 1);
  }

  @Button('trivia-2')
  public async onAnswer2(@Context() [interaction]: ButtonContext) {
    return this.handleAnswer(interaction, 2);
  }

  @Button('trivia-3')
  public async onAnswer3(@Context() [interaction]: ButtonContext) {
    return this.handleAnswer(interaction, 3);
  }

  private async handleAnswer(interaction: any, answerIndex: number) {
    const result = await this.economyService.answerTrivia(
      interaction.user.id,
      answerIndex,
      interaction.message.id,
    );

    if (!result.success) {
      return interaction.reply({
        content: result.message || 'This trivia session is no longer active.',
        ephemeral: true,
      });
    }

    const correct = result.correct === true;
    const embed = new EmbedBuilder()
      .setColor(correct ? '#2ecc71' : '#e74c3c')
      .setTitle(correct ? '🎉 Correct!' : '😢 Incorrect!')
      .setDescription(
        correct
          ? `You earned **${result.reward}** coins!`
          : 'Better luck next time!',
      )
      .setTimestamp();

    return interaction.update({ embeds: [embed], components: [] });
  }
}
