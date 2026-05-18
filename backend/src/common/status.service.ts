import { Injectable } from '@nestjs/common';

@Injectable()
export class StatusService {
  getStatus(): string {
    return 'Bot is online and responding!';
  }
}
