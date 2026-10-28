import {
  Body, Controller, Get, Param, ParseIntPipe, Post, Query, UseGuards,
} from '@nestjs/common';
import { AutoModRulesService } from '../../domain/moderation/automod-rules.service';
import type { AutoModRuleConfig } from '../../domain/moderation/automod-policy';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { GuildAccessGuard, RequireGuildManager } from '../auth/guild-access.guard';

@Controller('automod')
@RequireGuildManager()
@UseGuards(JwtAuthGuard, GuildAccessGuard)
export class AutoModController {
  constructor(private readonly rules: AutoModRulesService) {}

  @Get()
  list(@Query('guildId') guildId: string) {
    return this.rules.list(guildId);
  }

  @Post('rules')
  create(@Body() body: {
    guildId: string;
    rule: Omit<AutoModRuleConfig, 'id'> & { name: string };
  }) {
    return this.rules.create(body.guildId, body.rule);
  }

  @Post('rules/:id/enabled')
  enabled(
    @Param('id', ParseIntPipe) id: number,
    @Body() body: { guildId: string; enabled: boolean },
  ) {
    return this.rules.setEnabled(body.guildId, id, body.enabled);
  }
}
