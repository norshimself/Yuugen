import { Injectable } from '@nestjs/common';
import { Context, SlashCommand } from 'necord';
import type { SlashCommandContext } from 'necord';
import { StatusService } from '../../shared/status.service';

@Injectable()
export class PingCommand {
  constructor(private readonly statusService: StatusService) {}

  @SlashCommand({
    name: 'ping',
    description: 'Pings the bot',
  })
  public async onPing(@Context() [interaction]: SlashCommandContext) {
    return interaction.reply({
      content: `Pong! ${this.statusService.getStatus()}`,
    });
  }
}


