import { Injectable, Logger } from '@nestjs/common';
import { Context, Once } from 'necord';
import type { ContextOf } from 'necord';

@Injectable()
export class BotGateway {
  private readonly logger = new Logger(BotGateway.name);

  @Once('clientReady')
  onReady(@Context() [client]: ContextOf<'clientReady'>) {
    this.logger.log(`Bot is ready! Logged in as ${client.user?.tag}`);
  }
}

