import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, Button } from 'necord';
import type { SlashCommandContext, ButtonContext } from 'necord';
import { EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

@Injectable()
export class TriviaCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'trivia',
    description: 'Answer a trivia question to win coins!',
  })
  public async onTrivia(@Context() [interaction]: SlashCommandContext) {
    const activeSession = await this.economyService.getTriviaSession(interaction.user.id);
    if (activeSession) {
      return interaction.reply({
        content: 'You already have an active trivia game! Answer it first.',
        ephemeral: true,
      });
    }

    const question = await this.economyService.getRandomTriviaQuestion();
    const reward = 50;

    await this.economyService.startTriviaSession(interaction.user.id, question.correctIndex, reward);

    const embed = new EmbedBuilder()
      .setColor('#3498db')
      .setTitle('🧠 Trivia Time!')
      .setDescription(question.question)
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
    const game = await this.economyService.getTriviaSession(interaction.user.id);

    if (!game) {
      return interaction.reply({
        content: 'This trivia session is not for you or has expired!',
        ephemeral: true,
      });
    }

    await this.economyService.deleteTriviaSession(interaction.user.id);

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
