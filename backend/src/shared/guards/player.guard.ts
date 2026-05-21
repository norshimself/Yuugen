import { Injectable, CanActivate, ExecutionContext } from '@nestjs/common';
import { NecordExecutionContext } from 'necord';
import { LavalinkManager } from 'lavalink-client';
import { ChatInputCommandInteraction } from 'discord.js';

@Injectable()
export class PlayerGuard implements CanActivate {
  constructor(private readonly lavalinkManager: LavalinkManager) {}

  canActivate(context: ExecutionContext): boolean {
    const necordContext = NecordExecutionContext.create(context);
    const [interaction] = necordContext.getContext() as [
      ChatInputCommandInteraction,
    ];

    if (!interaction || !interaction.guildId) {
      if (interaction && interaction.reply) {
        interaction.reply({
          content: 'This command can only be used in a guild!',
          ephemeral: true,
        });
      }
      return false;
    }

    const player = this.lavalinkManager.players.get(interaction.guildId);
    if (!player) {
      interaction.reply({
        content: 'No music is playing!',
        ephemeral: true,
      });
      return false;
    }

    return true;
  }
}
