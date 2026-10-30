import {
  BadRequestException, Body, Controller, Get, Header, Post, Query, Req, UseGuards,
} from '@nestjs/common';
import { JwtAuthGuard } from '../../api/auth/jwt-auth.guard';
import { GuildAccessGuard, RequireGuildManager } from '../../api/auth/guild-access.guard';
import { ScheduledJobsService } from './scheduled-jobs.service';

const SNOWFLAKE = /^\d{17,20}$/;
const JOB_ID = /^[1-9]\d{0,18}$/;
const MAX_JOB_ID = 9223372036854775807n;

function parseMutation(value: unknown): { guildId: string; jobId: string } {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new BadRequestException('guildId and jobId are required');
  }
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).sort().join(',') !== 'guildId,jobId' ||
      typeof fields.guildId !== 'string' || !SNOWFLAKE.test(fields.guildId) ||
      typeof fields.jobId !== 'string' || !JOB_ID.test(fields.jobId) ||
      BigInt(fields.jobId) > MAX_JOB_ID) {
    throw new BadRequestException('Invalid scheduler job request');
  }
  return { guildId: fields.guildId, jobId: fields.jobId };
}

@Controller('scheduler/jobs')
@RequireGuildManager()
@UseGuards(JwtAuthGuard, GuildAccessGuard)
export class ScheduledJobsController {
  constructor(private readonly jobs: ScheduledJobsService) {}

  /** Metadata only. JWT, fresh guild membership and Manage Server required. */
  @Get('status')
  @Header('Cache-Control', 'no-store')
  async status(@Query('guildId') guildId: string) {
    return { counts: await this.jobs.statusCounts(guildId) };
  }

  @Get('failed')
  @Header('Cache-Control', 'no-store')
  async failed(@Query('guildId') guildId: string) {
    return { jobs: await this.jobs.failedJobs(guildId, 20) };
  }

  /** Cancel only this guild's pending/running job; running is best effort. */
  @Post('cancel')
  async cancel(
    @Body() body: unknown,
    @Req() request: { user: { id: string } },
  ) {
    const { guildId, jobId } = parseMutation(body);
    return { changed: await this.jobs.cancel(guildId, jobId, request.user.id) };
  }

  /**
   * An explicitly manager-authorized retry is limited to dead jobs whose
   * prior execution was proven NOT to have caused a remote side effect.
   * The database refuses replay of needs_review and other uncertain states.
   */
  @Post('retry')
  async retry(
    @Body() body: unknown,
    @Req() request: { user: { id: string } },
  ) {
    const { guildId, jobId } = parseMutation(body);
    return { changed: await this.jobs.retryDead(guildId, jobId, request.user.id) };
  }
}
