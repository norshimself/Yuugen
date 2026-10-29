import {
  BadRequestException, ConflictException, Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'node:crypto';
import { In, LessThan, Repository } from 'typeorm';
import {
  MAX_GUILD_PANELS, ROLE_MEMBER_COOLDOWN_MS, SNOWFLAKE,
  type RolePanelMode, type RolePanelOption, validatePanelOptions,
  validatePanelTitle, validPanelId, validateRoleLabel, normalizeGroupKey,
} from './role-panel-policy';
import { RolePanel } from './role-panel.entity';
import { RolePanelMemberLock } from './role-panel-member-lock.entity';
import { RolePanelAction } from './role-panel-action.entity';

const THIRTY_DAYS_MS = 30 * 24 * 60 * 60_000;
const TEN_MINUTES_MS = 10 * 60_000;

function checkGuildId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !SNOWFLAKE.test(id)) {
    throw new BadRequestException('Invalid guild ID');
  }
}
function checkUserId(id: unknown): asserts id is string {
  if (typeof id !== 'string' || !SNOWFLAKE.test(id)) {
    throw new BadRequestException('Invalid member ID');
  }
}
function checkPanelId(id: unknown): asserts id is number {
  if (!validPanelId(id)) throw new BadRequestException('Invalid panel ID');
}

@Injectable()
export class RolePanelService {
  private readonly lastPruned = new Map<string, number>();

  constructor(
    @InjectRepository(RolePanel)
    private readonly panels: Repository<RolePanel>,
    @InjectRepository(RolePanelMemberLock)
    private readonly locks: Repository<RolePanelMemberLock>,
    @InjectRepository(RolePanelAction)
    private readonly actions: Repository<RolePanelAction>,
  ) {}

  async getPanel(guildId: string, id: number): Promise<RolePanel | null> {
    checkGuildId(guildId);
    checkPanelId(id);
    return this.panels.findOne({ where: { guildId, id } });
  }

  async listPanels(guildId: string): Promise<RolePanel[]> {
    checkGuildId(guildId);
    return this.panels.find({
      where: { guildId }, order: { id: 'DESC' }, take: MAX_GUILD_PANELS,
    });
  }

  async createDraft(
    guildId: string, channelId: string, actorId: string,
    title: string, mode: RolePanelMode,
  ): Promise<RolePanel> {
    checkGuildId(guildId);
    checkUserId(actorId);
    if (!SNOWFLAKE.test(channelId) || !validatePanelTitle(title) ||
        (mode !== 'buttons' && mode !== 'select')) {
      throw new BadRequestException('Invalid role panel channel, title or mode');
    }
    const count = await this.panels.count({
      where: { guildId, status: In(['draft', 'publishing', 'active']) },
    });
    if (count >= MAX_GUILD_PANELS) {
      throw new BadRequestException('This server has too many active or draft panels');
    }
    return this.panels.save(this.panels.create({
      guildId, channelId, createdByUserId: actorId, title: title.trim(),
      mode, options: [], status: 'draft', revision: 0, messageId: null,
    }));
  }

  /** Draft-only compare-and-swap prevents lost updates from staff edits. */
  async addOption(
    guildId: string, panelId: number, roleId: string, label: string,
    groupKey: string | null, prerequisiteRoleId: string | null,
  ): Promise<RolePanel> {
    const panel = await this.getPanel(guildId, panelId);
    if (!panel || panel.status !== 'draft') {
      throw new BadRequestException('Only draft panels can be edited');
    }
    const group = normalizeGroupKey(groupKey);
    if (!SNOWFLAKE.test(roleId) || !validateRoleLabel(label) ||
        group === undefined ||
        (prerequisiteRoleId !== null && !SNOWFLAKE.test(prerequisiteRoleId))) {
      throw new BadRequestException('Invalid option role, label, group or prerequisite');
    }
    const usedIds = new Set(panel.options.map(option => option.id));
    const optionId = Array.from({ length: 25 }, (_, i) => i + 1)
      .find(id => !usedIds.has(id)) ?? 26;
    const options: RolePanelOption[] = [...panel.options, {
      id: optionId, roleId, label: label.trim(), groupKey: group,
      prerequisiteRoleId,
    }];
    const error = validatePanelOptions(panel.mode, options);
    if (error) throw new BadRequestException(error);
    return this.changeDraftOptions(panel, options);
  }

  async removeOption(
    guildId: string, panelId: number, optionId: number,
  ): Promise<RolePanel> {
    const panel = await this.getPanel(guildId, panelId);
    if (!panel || panel.status !== 'draft' || !validPanelId(optionId)) {
      throw new BadRequestException('Only valid draft options can be removed');
    }
    const options = panel.options.filter(option => option.id !== optionId);
    if (options.length === panel.options.length) {
      throw new BadRequestException('Option not found in this panel');
    }
    return this.changeDraftOptions(panel, options);
  }

  private async changeDraftOptions(
    panel: RolePanel, options: RolePanelOption[],
  ): Promise<RolePanel> {
    const updated = await this.panels.createQueryBuilder()
      .update(RolePanel)
      .set({ options, revision: panel.revision + 1 })
      .where('id = :id AND "guildId" = :guildId AND "status" = :status AND "revision" = :revision', {
        id: panel.id, guildId: panel.guildId,
        status: 'draft', revision: panel.revision,
      })
      .returning('*').execute();
    const row: RolePanel | undefined = updated.raw?.[0];
    if (!row) throw new ConflictException('Panel changed; re-run the command');
    return row;
  }

  /**
   * Reserve publish before sending, so duplicate staff commands cannot
   * publish twice. Uncertain sends remain inert until manual reconciliation.
   */
  async beginPublish(guildId: string, panelId: number): Promise<RolePanel> {
    const panel = await this.getPanel(guildId, panelId);
    if (!panel || panel.status !== 'draft' || panel.options.length === 0) {
      throw new BadRequestException('An unpublished panel with options is required');
    }
    const error = validatePanelOptions(panel.mode, panel.options);
    if (error) throw new BadRequestException(error);
    const changed = await this.panels.createQueryBuilder()
      .update(RolePanel)
      .set({ status: 'publishing' })
      .where('id = :id AND "guildId" = :guildId AND "status" = :status AND "revision" = :revision', {
        id: panel.id, guildId, status: 'draft', revision: panel.revision,
      })
      .returning('*').execute();
    const row: RolePanel | undefined = changed.raw?.[0];
    if (!row) throw new ConflictException('Another staff member is publishing this panel');
    return row;
  }

  async activate(guildId: string, panelId: number, messageId: string): Promise<boolean> {
    checkGuildId(guildId);
    checkPanelId(panelId);
    if (!SNOWFLAKE.test(messageId)) throw new BadRequestException('Invalid panel message ID');
    const changed = await this.panels.update({
      guildId, id: panelId, status: 'publishing',
    }, { status: 'active', messageId });
    return (changed.affected || 0) === 1;
  }

  async disable(guildId: string, panelId: number): Promise<RolePanel | null> {
    const panel = await this.getPanel(guildId, panelId);
    if (!panel) return null;
    if (panel.status === 'disabled') return panel;
    const changed = await this.panels.createQueryBuilder()
      .update(RolePanel)
      .set({ status: 'disabled' })
      .where('id = :id AND "guildId" = :guildId AND "status" = :status', {
        id: panelId, guildId, status: panel.status,
      }).returning('*').execute();
    return changed.raw?.[0] ?? null;
  }

  /** Acquire per-guild/member lease using a single atomic PostgreSQL upsert. */
  async acquireMember(
    guildId: string, userId: string,
  ): Promise<{ token: string; coolingDown: boolean } | null> {
    checkGuildId(guildId);
    checkUserId(userId);
    const token = randomUUID();
    const rows: { lastActionAt: Date | null }[] = await this.locks.query(
      [
        'INSERT INTO "role_panel_member_locks"',
        '("guildId","userId","token","expiresAt","lastActionAt")',
        "VALUES ($1,$2,$3,NOW() + INTERVAL '90 seconds',NULL)",
        'ON CONFLICT ("guildId","userId") DO UPDATE',
        'SET "token" = EXCLUDED."token", "expiresAt" = EXCLUDED."expiresAt"',
        'WHERE "role_panel_member_locks"."expiresAt" <= NOW()',
        'RETURNING "lastActionAt"',
      ].join(' '),
      [guildId, userId, token],
    );
    if (rows.length !== 1) return null;
    const last = rows[0].lastActionAt;
    return {
      token,
      coolingDown: !!last && Date.now() - new Date(last).getTime()
        < ROLE_MEMBER_COOLDOWN_MS,
    };
  }

  async hasMemberLease(guildId: string, userId: string, token: string): Promise<boolean> {
    if (!SNOWFLAKE.test(guildId) || !SNOWFLAKE.test(userId)) return false;
    const lock = await this.locks.findOne({
      where: { guildId, userId, token },
    });
    return !!lock && lock.expiresAt.getTime() > Date.now();
  }

  async releaseMember(
    guildId: string, userId: string, token: string, recordCooldown: boolean,
  ): Promise<void> {
    checkGuildId(guildId);
    checkUserId(userId);
    if (!/^[0-9a-f-]{36}$/.test(token)) return;
    const values: Partial<RolePanelMemberLock> = {
      token: null, expiresAt: new Date(0),
      ...(recordCooldown ? { lastActionAt: new Date() } : {}),
    };
    // The token predicate prevents a stale worker releasing another lock.
    await this.locks.createQueryBuilder()
      .update(RolePanelMemberLock)
      .set(values)
      .where('"guildId" = :guildId AND "userId" = :userId AND "token" = :token', {
        guildId, userId, token,
      }).execute();
  }

  /** Persist unique interaction metadata BEFORE any Discord role mutation. */
  async beginAction(
    interactionId: string, guildId: string, userId: string,
    panelId: number, optionId: number, roleId: string,
  ): Promise<number | null> {
    checkGuildId(guildId);
    checkUserId(userId);
    if (!SNOWFLAKE.test(interactionId) || !SNOWFLAKE.test(roleId) ||
        !validPanelId(panelId) || !validPanelId(optionId)) {
      throw new BadRequestException('Invalid interaction audit identity');
    }
    await this.pruneAudit(guildId);
    const inserted = await this.actions.createQueryBuilder()
      .insert().into(RolePanelAction)
      .values({
        interactionId, guildId, userId, panelId, optionId, roleId, status: 'pending',
      }).orIgnore().returning('*').execute();
    const id: number | undefined = inserted.raw?.[0]?.id;
    return Number.isSafeInteger(id) && id! > 0 ? id! : null;
  }

  async finishAction(
    guildId: string, id: number,
    status: 'added' | 'removed' | 'partial' | 'uncertain' | 'denied',
  ): Promise<boolean> {
    checkGuildId(guildId);
    if (!validPanelId(id) ||
        !['added', 'removed', 'partial', 'uncertain', 'denied'].includes(status)) {
      throw new BadRequestException('Invalid role action completion');
    }
    const changed = await this.actions.update(
      { guildId, id, status: 'pending' }, { status },
    );
    return (changed.affected || 0) === 1;
  }

  private async pruneAudit(guildId: string): Promise<void> {
    const now = Date.now();
    if (now - (this.lastPruned.get(guildId) || 0) < TEN_MINUTES_MS) return;
    await this.actions.delete({
      guildId, createdAt: LessThan(new Date(now - THIRTY_DAYS_MS)),
    });
    await this.locks.delete({
      guildId, expiresAt: LessThan(new Date(now - THIRTY_DAYS_MS)),
      lastActionAt: LessThan(new Date(now - THIRTY_DAYS_MS)),
    });
    if (this.lastPruned.size >= 500) this.lastPruned.clear();
    this.lastPruned.set(guildId, now);
  }
}
