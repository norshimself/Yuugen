import { Module } from '@nestjs/common';
import { TicketService } from './ticket.service';

/** Uses the existing global TypeORM DataSource, not repository auto-sync. */
@Module({ providers:[TicketService], exports:[TicketService] })
export class TicketModule {}
