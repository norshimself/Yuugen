import { Injectable } from '@nestjs/common';
import { Context, SlashCommand, Options, UserOption } from 'necord';
import type { SlashCommandContext } from 'necord';
import { EmbedBuilder, User } from 'discord.js';
import { EconomyService } from '../../../domain/economy/economy.service';

class RobOptions {
  @UserOption({
    name: 'user',
    description: 'The user to rob',
    required: true,
  })
  user: User;
}

@Injectable()
export class RobCommand {
  constructor(private readonly economyService: EconomyService) {}

  @SlashCommand({
    name: 'rob',
    description: 'Attempt to rob coins from another user!',
  })
  public async onRob(
    @Context() [interaction]: SlashCommandContext,
    @Options() { user }: RobOptions,
  ) {
    if (user.id === interaction.user.id) {
      return interaction.reply({
        content: `You can't rob yourself!`,
        ephemeral: true,
      });
    }

    if (user.bot) {
      return interaction.reply({
        content: `You can't rob bots!`,
        ephemeral: true,
      });
    }

    const result = await this.economyService.rob(interaction.user.id, user.id);

    if (!result.success) {
      if (result.isTooPoor) {
        return interaction.reply({
          content: `This user is too poor to be robbed (needs at least 50 coins)!`,
          ephemeral: true,
        });
      }
      
      const embed = new EmbedBuilder()
        .setColor('#FFA500')
        .setTitle('Slow down!')
        .setDescription(`You can rob again <t:${Math.floor(result.nextClaim!.getTime() / 1000)}:R>.`)
        .setTimestamp();
      return interaction.reply({ embeds: [embed], ephemeral: true });
    }

    const embed = new EmbedBuilder()
      .setColor(result.won ? '#00FF00' : '#FF0000')
      .setTitle(result.won ? 'Success!' : 'Busted!')
      .setDescription(
        result.won
          ? `You successfully robbed **${user.username}** and got away with **${result.amount}** coins!`
          : `You tried to rob **${user.username}** but failed! You paid them a fine of **${result.amount}** coins.`,
      )
      .setTimestamp();

    return interaction.reply({ embeds: [embed] });
  }
}
