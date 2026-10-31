import { Injectable, Logger } from '@nestjs/common';
import { Context, On } from 'necord';
import type { ContextOf } from 'necord';
import { TicketService } from '../../../domain/tickets/ticket.service';
import { TICKET_FEATURE_FLAG, validId } from '../../../domain/tickets/ticket-policy';
import { ConfigService } from '@nestjs/config';

/** Record external deletion without trying to recreate or delete anything. */
@Injectable()
export class TicketChannelEvents {
  private readonly logger = new Logger(TicketChannelEvents.name);
  constructor(private readonly tickets:TicketService,private readonly config:ConfigService) {}

  @On('channelDelete')
  async onDeleted(@Context() [channel]:ContextOf<'channelDelete'>) {
    if(this.config.get<string>(TICKET_FEATURE_FLAG)!=='true')return;
    const guildId='guildId' in channel ? channel.guildId : null;
    if(!validId(guildId) || !validId(channel.id))return;
    try {await this.tickets.channelDeleted(guildId,channel.id);}
    catch {this.logger.warn('Ticket channel deletion could not be recorded; inspect database');}
  }
}
