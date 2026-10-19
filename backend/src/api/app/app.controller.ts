import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { AppService } from './app.service';
import { ReadinessReport, StatusService } from '../../shared/status.service';

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

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async getReadiness(): Promise<ReadinessReport> {
    const report = await this.statusService.checkReadiness();
    if (report.status !== 'ready') {
      throw new ServiceUnavailableException(report);
    }
    return report;
  }
}
