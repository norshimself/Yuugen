import { Controller, Get } from '@nestjs/common';
import { AppService } from './app.service';
import { StatusService } from '../../shared/status.service';

@Controller()
export class AppController {
  constructor(
    private readonly appService: AppService,
    private readonly statusService: StatusService,
  ) {}

  @Get()
  getHello(): string {
    return this.appService.getHello();
  }

  @Get('status')
  getStatus(): string {
    return this.statusService.getStatus();
  }
}

