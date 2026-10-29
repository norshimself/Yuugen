import {
  BadRequestException, ConflictException, Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, LessThan, Repository } from 'typeorm';
import { GuildVerificationConfig } from './guild-verification-config.entity';
import { GuildVerificationSession } from './guild-verification-session.entity';
import { GuildVerificationAction } from './guild-verification-action.entity';
import {
  MAX_QUESTION_ATTEMPTS, validDiscordId, validJoinSession,
  validVerificationPrompt, makeAnswerProof, matchesAnswer,
  type VerificationMode, type VerificationSessionStatus,
} from './verification-policy';

const AUDIT_RETENTION_MS = 30 * 24 * 60 * 60_000;
const CLEAN_INTERVAL_MS = 10 * 60_000;
type Completion = 'succeeded' | 'denied' | 'failed' | 'uncertain';

function checkGuild(value: unknown): asserts value is string {
  if (!validDiscordId(value)) throw new BadRequestException('Invalid guild ID');
}
function checkUser(value: unknown): asserts value is string {
  if (!validDiscordId(value)) throw new BadRequestException('Invalid member ID');
}

@Injectable()
export class VerificationService {
  private readonly lastCleaned = new Map<string, number>();

  constructor(
    @InjectRepository(GuildVerificationConfig)
    private readonly configs: Repository<GuildVerificationConfig>,
    @InjectRepository(GuildVerificationSession)
    private readonly sessions: Repository<GuildVerificationSession>,
    @InjectRepository(GuildVerificationAction)
    private readonly actions: Repository<GuildVerificationAction>,
  ) {}

  async getConfig(guildId: string): Promise<GuildVerificationConfig | null> {
    checkGuild(guildId);
    return this.configs.findOne({ where: { guildId } });
  }

  async activeConfig(guildId: string): Promise<GuildVerificationConfig | null> {
    const config = await this.getConfig(guildId);
    return config?.status === 'active' ? config : null;
  }

  async getSession(
    guildId: string, userId: string,
  ): Promise<GuildVerificationSession | null> {
    checkGuild(guildId);
    checkUser(userId);
    return this.sessions.findOne({ where: { guildId, userId } });
  }

  /**
   * Live self-role permission gate. A currently unverified member cannot
   * assign cosmetic roles (which might grant channel access via overwrites).
   * Newly present members with no receipt are blocked while verification is
   * active and may be grandfathered only by a staff override.
   */
  async isRestricted(
    guildId: string, userId: string, joinedTimestamp: number | null,
  ): Promise<boolean> {
    const [config, receipt] = await Promise.all([
      this.getConfig(guildId), this.getSession(guildId, userId),
    ]);
    const join = joinedTimestamp === null ? null : String(joinedTimestamp);
    if (receipt && join && receipt.sessionKey === join) {
      return receipt.status !== 'released';
    }
    return config?.status === 'active';
  }

  /** Only a disabled panel may be replaced; there is no implicit activation. */
  async setup(
    guildId: string, channelId: string, quarantineRoleId: string,
    actorId: string, mode: VerificationMode,
    questionPrompt?: string, answer?: string,
  ): Promise<GuildVerificationConfig> {
    checkGuild(guildId);checkUser(actorId);
    if (!validDiscordId(channelId) || !validDiscordId(quarantineRoleId) ||
        !['button', 'question'].includes(mode)) {
      throw new BadRequestException('Invalid verification destination or mode');
    }
    if (mode === 'question' &&
        (!validVerificationPrompt(questionPrompt) ||
          !makeAnswerProof(answer || ''))) {
      throw new BadRequestException('Question and a short answer are required');
    }
    const proof = mode === 'question' ? makeAnswerProof(answer!) : null;
    if (mode === 'question' && !proof) {
      throw new BadRequestException('Invalid verification answer');
    }
    const existing = await this.getConfig(guildId);
    if (existing && existing.status !== 'disabled') {
      throw new BadRequestException('Disable the existing verification panel before replacing it');
    }
    const data = {
      channelId, quarantineRoleId, updatedByUserId: actorId,
      mode, status: 'draft' as const, messageId: null,
      questionPrompt: mode === 'question' ? questionPrompt!.trim() : null,
      answerSalt: proof?.salt || null, answerDigest: proof?.digest || null,
    };
    if (!existing) {
      return this.configs.save(this.configs.create({
        guildId, revision: 1, ...data,
      }));
    }
    if (existing.revision >= 999999999) {
      throw new BadRequestException('Verification revision limit reached');
    }
    const changed = await this.configs.createQueryBuilder()
      .update(GuildVerificationConfig)
      .set({ ...data, revision: existing.revision + 1 })
      .where('"guildId" = :guildId AND "status" = :status AND "revision" = :revision', {
        guildId, status: 'disabled', revision: existing.revision,
      }).returning('*').execute();
    const row: GuildVerificationConfig | undefined = changed.raw?.[0];
    if (!row) throw new ConflictException('Verification configuration changed concurrently');
    return row;
  }

  async beginPublish(guildId: string): Promise<GuildVerificationConfig> {
    const config = await this.getConfig(guildId);
    if (!config || config.status !== 'draft') {
      throw new BadRequestException('An unpublished verification draft is required');
    }
    const updated = await this.configs.createQueryBuilder()
      .update(GuildVerificationConfig)
      .set({ status: 'publishing' })
      .where('"guildId" = :guildId AND "status" = :status AND "revision" = :revision', {
        guildId, status: 'draft', revision: config.revision,
      }).returning('*').execute();
    const row: GuildVerificationConfig | undefined = updated.raw?.[0];
    if (!row) throw new ConflictException('Another staff member is publishing verification');
    return row;
  }

  async activate(guildId: string, revision: number, messageId: string): Promise<boolean> {
    checkGuild(guildId);
    if (!Number.isSafeInteger(revision) || !validDiscordId(messageId)) {
      throw new BadRequestException('Invalid verification message');
    }
    const updated = await this.configs.update(
      { guildId, revision, status: 'publishing' },
      { status: 'active', messageId },
    );
    return (updated.affected || 0) === 1;
  }

  async disable(guildId: string): Promise<GuildVerificationConfig | null> {
    const current = await this.getConfig(guildId);
    if (!current || current.status === 'disabled') return current;
    const updated = await this.configs.createQueryBuilder()
      .update(GuildVerificationConfig).set({ status: 'disabled' })
      .where('"guildId" = :guildId AND "status" = :status AND "revision" = :revision', {
        guildId, status: current.status, revision: current.revision,
      }).returning('*').execute();
    return updated.raw?.[0] || null;
  }

  /**
   * First gateway worker wins the new join session. Duplicate or out-of-order
   * join events do NOT replace the row; a later real rejoin resets attempts.
   * An active matching guild configuration is required inside the SQL claim.
   */
  async claimJoin(
    guildId: string, userId: string, sessionKey: string, roleId: string,
  ): Promise<string | null> {
    checkGuild(guildId);checkUser(userId);
    if (!validJoinSession(sessionKey) || !validDiscordId(roleId)) return null;
    const token = randomUUID();
    const sql = [
      'INSERT INTO "guild_verification_sessions"',
      '("guildId","userId","sessionKey","quarantineRoleId","status","claimToken","wrongAnswers")',
      "SELECT $1,$2,$3,$4,'join_pending',$5,0 FROM \"guild_verification_configs\"",
      'WHERE "guildId" = $1 AND "status" = \'active\' AND "quarantineRoleId" = $4',
      'ON CONFLICT ("guildId","userId") DO UPDATE',
      'SET "sessionKey" = EXCLUDED."sessionKey",',
      '"quarantineRoleId" = EXCLUDED."quarantineRoleId",',
      '"status" = \'join_pending\', "claimToken" = EXCLUDED."claimToken",',
      '"wrongAnswers" = 0, "releasedAt" = NULL, "updatedAt" = NOW()',
      'WHERE ("guild_verification_sessions"."sessionKey"::bigint)',
      '< (EXCLUDED."sessionKey"::bigint)',
      'RETURNING "sessionKey"',
    ].join(' ');
    const rows: { sessionKey: string }[] = await this.sessions.query(
      sql, [guildId, userId, sessionKey, roleId, token],
    );
    return rows.length === 1 && rows[0].sessionKey === sessionKey ? token : null;
  }

  async finishJoin(
    guildId: string, userId: string, sessionKey: string, token: string,
    status: Extract<VerificationSessionStatus,
      'quarantined' | 'join_failed' | 'join_uncertain'>,
  ): Promise<boolean> {
    if (!validJoinSession(sessionKey) || !/^[0-9a-f-]{36}$/.test(token) ||
        !['quarantined', 'join_failed', 'join_uncertain'].includes(status)) {
      throw new BadRequestException('Invalid join completion');
    }
    const updated = await this.sessions.update({
      guildId, userId, sessionKey, claimToken: token,
      status: 'join_pending',
    }, { status, claimToken: null });
    return (updated.affected || 0) === 1;
  }

  /**
   * Claim a single release, including manual rechecks after uncertain
   * Discord outcomes. A self-service release requires quarantined state,
   * a current session and fewer than five wrong answers.
   */
  async claimRelease(
    guildId: string, userId: string, sessionKey: string, manual: boolean,
  ): Promise<{ token: string; roleId: string } | null> {
    checkGuild(guildId);checkUser(userId);
    if (!validJoinSession(sessionKey)) return null;
    const token = randomUUID();
    const statuses: VerificationSessionStatus[] = manual
      ? ['quarantined', 'join_failed', 'join_uncertain', 'release_uncertain']
      : ['quarantined'];
    const builder = this.sessions.createQueryBuilder()
      .update(GuildVerificationSession)
      .set({ status: 'release_pending', claimToken: token })
      .where('"guildId" = :guildId AND "userId" = :userId AND "sessionKey" = :sessionKey', {
        guildId, userId, sessionKey,
      })
      .andWhere('"status" IN (:...statuses)', { statuses });
    if (!manual) builder.andWhere('"wrongAnswers" < :limit', {
      limit: MAX_QUESTION_ATTEMPTS,
    });
    const updated = await builder.returning('*').execute();
    const row: GuildVerificationSession | undefined = updated.raw?.[0];
    return row ? { token, roleId: row.quarantineRoleId } : null;
  }

  /** Staff may explicitly exempt an existing member who was present at setup. */
  async prepareOverride(
    guildId: string, userId: string, sessionKey: string, roleId: string,
  ): Promise<void> {
    checkGuild(guildId);checkUser(userId);
    if (!validJoinSession(sessionKey) || !validDiscordId(roleId)) {
      throw new BadRequestException('Invalid override member session');
    }
    await this.sessions.createQueryBuilder()
      .insert().into(GuildVerificationSession)
      .values({
        guildId, userId, sessionKey, quarantineRoleId: roleId,
        status: 'quarantined', claimToken: null,
        wrongAnswers: 0, releasedAt: null,
      }).orIgnore().execute();
  }

  async finishRelease(
    guildId: string, userId: string, sessionKey: string, token: string,
    outcome: 'released' | 'quarantined' | 'release_uncertain',
  ): Promise<boolean> {
    checkGuild(guildId);checkUser(userId);
    if (!validJoinSession(sessionKey) || !/^[0-9a-f-]{36}$/.test(token) ||
        !['released', 'quarantined', 'release_uncertain'].includes(outcome)) {
      throw new BadRequestException('Invalid release completion');
    }
    const updated = await this.sessions.update({
      guildId, userId, sessionKey, status: 'release_pending', claimToken: token,
    }, {
      status: outcome, claimToken: null,
      releasedAt: outcome === 'released' ? new Date() : null,
    });
    return (updated.affected || 0) === 1;
  }

  async countWrongAnswer(
    guildId: string, userId: string, sessionKey: string,
  ): Promise<number | null> {
    checkGuild(guildId);checkUser(userId);
    if (!validJoinSession(sessionKey)) return null;
    const changed = await this.sessions.createQueryBuilder()
      .update(GuildVerificationSession)
      .set({ wrongAnswers: () => '"wrongAnswers" + 1' })
      .where('"guildId" = :guildId AND "userId" = :userId AND "sessionKey" = :sessionKey', {
        guildId, userId, sessionKey,
      })
      .andWhere('"status" = :status AND "wrongAnswers" < :max', {
        status: 'quarantined', max: MAX_QUESTION_ATTEMPTS,
      }).returning('"wrongAnswers"').execute();
    return Number.isSafeInteger(changed.raw?.[0]?.wrongAnswers)
      ? changed.raw[0].wrongAnswers : null;
  }

  /** Idempotent, metadata-only attempts; no challenge answers or reason text. */
  async beginAction(
    guildId: string, eventKey: string, userId: string, actorId: string,
    sessionKey: string,
    action: 'join' | 'verify' | 'wrong_answer' | 'override',
  ): Promise<number | null> {
    checkGuild(guildId);checkUser(userId);checkUser(actorId);
    if (typeof eventKey !== 'string' || eventKey.length > 96 ||
        !/^(?:[0-9]{17,20}|join:[0-9]{17,20}:[0-9]{12,16})$/.test(eventKey) ||
        !validJoinSession(sessionKey) ||
        !['join','verify','wrong_answer','override'].includes(action)) {
      throw new BadRequestException('Invalid verification audit key');
    }
    const result = await this.actions.createQueryBuilder()
      .insert().into(GuildVerificationAction)
      .values({
        guildId, eventKey, userId, actorId, sessionKey, action,
        status: 'pending',
      }).orIgnore().returning('*').execute();
    const id = result.raw?.[0]?.id;
    return Number.isSafeInteger(id) && id > 0 ? id : null;
  }

  async finishAction(
    guildId: string, id: number, outcome: Completion,
  ): Promise<boolean> {
    checkGuild(guildId);
    if (!Number.isSafeInteger(id) || id < 1 ||
        !['succeeded', 'denied', 'failed', 'uncertain'].includes(outcome)) {
      throw new BadRequestException('Invalid verification audit result');
    }
    const update = await this.actions.update(
      { guildId, id, status: 'pending' }, { status: outcome },
    );
    return (update.affected || 0) === 1;
  }

  async recentActions(guildId: string): Promise<GuildVerificationAction[]> {
    checkGuild(guildId);
    return this.actions.find({
      where: { guildId,
        createdAt: LessThan(new Date(Date.now() + 1000)) },
      order: { createdAt: 'DESC', id: 'DESC' }, take: 20,
    });
  }

  async purgeExpiredAudit(guildId: string): Promise<void> {
    checkGuild(guildId);
    const now = Date.now();
    if (now - (this.lastCleaned.get(guildId) || 0) < CLEAN_INTERVAL_MS) return;
    await this.actions.delete({
      guildId, createdAt: LessThan(new Date(now - AUDIT_RETENTION_MS)),
    });
    if (this.lastCleaned.size >= 500) this.lastCleaned.clear();
    this.lastCleaned.set(guildId, now);
  }

  answerMatches(config: GuildVerificationConfig, response: unknown): boolean {
    return config.mode === 'question' &&
      matchesAnswer(response, config.answerSalt, config.answerDigest);
  }
}
