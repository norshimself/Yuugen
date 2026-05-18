import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, Button } from 'necord';
import type { SlashCommandContext, ButtonContext } from 'necord';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

@Injectable()
export class TriviaCommand {
  constructor(private readonly economyService: EconomyService) {}

  // Store active games: userId -> { correctIndex: number, reward: number }
  private activeGames = new Map<string, { correctIndex: number; reward: number }>();

  private questions = [
    { q: 'What is the capital of France?', options: ['Paris', 'London', 'Berlin', 'Madrid'], correct: 0 },
    { q: 'What is 2 + 2?', options: ['3', '4', '5', '6'], correct: 1 },
    { q: 'What is the largest ocean?', options: ['Atlantic', 'Indian', 'Arctic', 'Pacific'], correct: 3 },
    { q: 'Who wrote "Romeo and Juliet"?', options: ['Charles Dickens', 'William Shakespeare', 'Mark Twain', 'Jane Austen'], correct: 1 },
    { q: 'What is the chemical symbol for gold?', options: ['Gd', 'Go', 'Ag', 'Au'], correct: 3 },
  ];

  @SlashCommand({
    name: 'trivia',
    description: 'Answer a trivia question to win coins!',
  })
  public async onTrivia(@Context() [interaction]: SlashCommandContext) {
    if (this.activeGames.has(interaction.user.id)) {
      return interaction.reply({
        content: 'You already have an active trivia game! Answer it first.',
        ephemeral: true,
      });
    }

    const randomIdx = Math.floor(Math.random() * this.questions.length);
    const question = this.questions[randomIdx];
    const reward = 50;

    this.activeGames.set(interaction.user.id, { correctIndex: question.correct, reward });

    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('🧠 Trivia Time!')
      .setDescription(question.q)
      .setFooter({ text: `Reward: ${reward} coins` })
      .setTimestamp();

    const row = new ActionRowBuilder<ButtonBuilder>();

    question.options.forEach((option, index) => {
      row.addComponents(
        new ButtonBuilder()
          .setCustomId(`trivia-${index}`)
          .setLabel(option)
          .setStyle(ButtonStyle.Primary),
      );
    });

    return interaction.reply({ embeds: [embed], components: [row] });
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
    const game = this.activeGames.get(interaction.user.id);

    if (!game) {
      return interaction.reply({
        content: 'This trivia session is not for you or has expired!',
        ephemeral: true,
      });
    }

    this.activeGames.delete(interaction.user.id);

    const isCorrect = answerIndex === game.correctIndex;

    if (isCorrect) {
      await this.economyService.addCoins(interaction.user.id, game.reward);
      
      const embed = new EmbedBuilder()
        .setColor('#2ecc71')
        .setTitle('🎉 Correct!')
        .setDescription(`You got it right and earned **${game.reward}** coins!`)
        .setTimestamp();

      return interaction.update({ embeds: [embed], components: [] });
    } else {
      const embed = new EmbedBuilder()
        .setColor('#e74c3c')
        .setTitle('😢 Incorrect!')
        .setDescription('Better luck next time!')
        .setTimestamp();

      return interaction.update({ embeds: [embed], components: [] });
    }
  }
}
