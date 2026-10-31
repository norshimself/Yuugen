import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { Session } from '../../api/auth/session.entity';
import { UserProfile } from '../economy/user-profile.entity';
import { TriviaSession } from '../economy/trivia-session.entity';
import { GuildSettings } from '../settings/guild-settings.entity';
import { AutoModRule } from '../moderation/automod-rule.entity';
import {
  RETENTION, RETAINED_ON_SELF_ERASURE, assertDiscordId, autoModRuleExport,
  economyExport, guildSettingsExport, sessionMetadata, triviaExport,
} from './privacy-policy';

const MAX_SESSION_EXPORT = 50;
const MAX_GUILD_RULES_EXPORT = 100;

@Injectable()
export class PrivacyService {
  constructor(
    @InjectRepository(Session) private readonly sessions: Repository<Session>,
    @InjectRepository(UserProfile) private readonly profiles: Repository<UserProfile>,
    @InjectRepository(TriviaSession) private readonly trivia: Repository<TriviaSession>,
    @InjectRepository(GuildSettings) private readonly settings: Repository<GuildSettings>,
    @InjectRepository(AutoModRule) private readonly automod: Repository<AutoModRule>,
    private readonly db: DataSource,
  ) {}

  /**
   * Read-only and self-scoped. Never call EconomyService.getProfile(): that
   * method creates a profile as a side effect. Do not expose session IDs.
   */
  async exportSelf(userId: string) {
    assertDiscordId(userId, 'user ID');
    const [profile, game, sessionCount, recentSessions] = await Promise.all([
      this.profiles.findOne({ where: { userId } }),
      this.trivia.findOne({ where: { userId } }),
      this.sessions.count({ where: { userId } }),
      this.sessions.find({
        where: { userId },
        order: { createdAt: 'DESC' },
        take: MAX_SESSION_EXPORT,
      }),
    ]);
    return {
      scope: 'authenticated_user',
      exportedAt: new Date().toISOString(),
      userId,
      economy: economyExport(profile),
      trivia: triviaExport(game),
      authentication: {
        count: sessionCount,
        sessions: recentSessions.map(sessionMetadata),
        truncated: sessionCount > MAX_SESSION_EXPORT,
        // Raw session IDs are authentication secrets, NOT exportable values.
      },
      excludedFromAutomaticExport: [
        'moderation_audit_subject_or_staff_records',
        'guild_configuration',
        'other_discord_and_third_party_data',
        'unmerged_feature_branch_datasets',
      ],
    };
  }

  /**
   * A guild MANAGER can inspect configuration belonging ONLY to that guild.
   * This must be protected by the live GuildAccessGuard, not a caller-supplied
   * actor or user ID. Does not create a default settings row.
   */
  async exportGuild(guildId: string) {
    assertDiscordId(guildId, 'guild ID');
    const [settings, rules] = await Promise.all([
      this.settings.findOne({ where: { guildId } }),
      this.automod.find({
        where: { guildId }, order: { id: 'ASC' },
        take: MAX_GUILD_RULES_EXPORT + 1,
      }),
    ]);
    return {
      scope: 'guild_configuration',
      guildId,
      exportedAt: new Date().toISOString(),
      settings: guildSettingsExport(settings),
      automodRules: rules.slice(0, MAX_GUILD_RULES_EXPORT).map(autoModRuleExport),
      truncated: rules.length > MAX_GUILD_RULES_EXPORT,
      excludedFromAutomaticExport: [
        'moderation_audit_requiring_staff_or_legal_review',
        'economy_global_user_profiles',
        'cross_guild_member_records',
      ],
    };
  }

  /**
   * Explicit user-requested erasure of the current global economy model,
   * trivia session, and all sign-in sessions. The authenticated actor is the
   * ONLY userId supplied; there is no target-user deletion API.
   * Moderation/legal audit and other guilds' settings are preserved.
   *
   * Repeat requests are safe: all three deletes are user-keyed, idempotent
   * and committed together. Repeated bot use MAY create a new profile.
   */
  async eraseSelf(userId: string) {
    assertDiscordId(userId, 'user ID');
    const removed = await this.db.transaction(async (manager) => {
      const game = await manager.getRepository(TriviaSession).delete({ userId });
      const economy = await manager.getRepository(UserProfile).delete({ userId });
      const auth = await manager.getRepository(Session).delete({ userId });
      return {
        economyProfiles: economy.affected ?? 0,
        triviaSessions: game.affected ?? 0,
        authSessions: auth.affected ?? 0,
      };
    });
    return {
      success: true,
      scope: 'global_economy_and_ephemeral_auth',
      removed,
      retainedForSeparateReview: [...RETAINED_ON_SELF_ERASURE],
      // Existing 15-minute access JWTs cannot be revoked by deleting cookies.
      accessTokens: 'existing_jwts_expire_within_15_minutes',
      notice: 'Future Discord bot use may create fresh economy data',
    };
  }

  /**
   * Opt-in incremental TTL cleanup. Both statements use PostgreSQL time,
   * bounded batches and SKIP LOCKED so multiple workers cannot delete the
   * same row twice. Never return session token IDs to the app or logs.
   */
  async pruneExpiredEphemeral(): Promise<{
    sessions: number; triviaSessions: number;
  }> {
    const [expiredAuth] = await this.db.query(
      `WITH due AS (
        SELECT "id" FROM public.sessions
        WHERE "expiresAt" <= clock_timestamp()
        ORDER BY "expiresAt","id"
        LIMIT $1 FOR UPDATE SKIP LOCKED
      ), removed AS (
        DELETE FROM public.sessions AS s USING due WHERE s."id"=due."id"
        RETURNING 1
      ) SELECT count(*)::integer AS count FROM removed`,
      [RETENTION.batchSize],
    );
    const [expiredTrivia] = await this.db.query(
      `WITH due AS (
        SELECT "userId" FROM public.trivia_sessions
        WHERE "createdAt" <= clock_timestamp() -
          ($2::integer * INTERVAL '1 minute')
        ORDER BY "createdAt","userId"
        LIMIT $1 FOR UPDATE SKIP LOCKED
      ), removed AS (
        DELETE FROM public.trivia_sessions AS t USING due
        WHERE t."userId"=due."userId" RETURNING 1
      ) SELECT count(*)::integer AS count FROM removed`,
      [RETENTION.batchSize, RETENTION.triviaLifetimeMinutes],
    );
    return {
      sessions: Number(expiredAuth.count),
      triviaSessions: Number(expiredTrivia.count),
    };
  }
}
