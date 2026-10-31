import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AutoModRule } from './automod-rule.entity';
import { validateAutoModRule, type AutoModRuleConfig } from './automod-policy';

const SNOWFLAKE = /^\d{17,20}$/;

@Injectable()
export class AutoModRulesService {
  private readonly cache = new Map<string, { rules: AutoModRule[]; expires: number }>();
  constructor(
    @InjectRepository(AutoModRule)
    private readonly repo: Repository<AutoModRule>,
  ) {}

  async list(guildId: string): Promise<AutoModRule[]> {
    if (!SNOWFLAKE.test(guildId)) throw new BadRequestException('Invalid guild');
    const cached = this.cache.get(guildId);
    if (cached && cached.expires > Date.now()) return cached.rules;
    const rules = await this.repo.find({
      where: { guildId },
      order: { priority: 'ASC', id: 'ASC' },
      take: 50,
    });
    if (this.cache.size > 500) this.cache.clear();
    this.cache.set(guildId, { rules, expires: Date.now() + 5000 });
    return rules;
  }

  async create(
    guildId: string,
    input: Omit<AutoModRuleConfig, 'id'> & { name: string },
  ): Promise<AutoModRule> {
    if (!SNOWFLAKE.test(guildId)) throw new BadRequestException('Invalid guild');
    if (typeof input?.name !== 'string' || !input.name.trim() ||
        input.name.length > 48) throw new BadRequestException('Invalid rule name');
    const problem = validateAutoModRule(input);
    if (problem) throw new BadRequestException(problem);
    const count = await this.repo.count({ where: { guildId } });
    if (count >= 50) throw new BadRequestException('Maximum 50 rules per guild');
    const saved = await this.repo.save(this.repo.create({
      guildId,
      name: input.name.trim(),
      enabled: input.enabled,
      kind: input.kind,
      action: input.action,
      priority: input.priority,
      phrases: [...input.phrases],
      threshold: input.threshold,
      windowSeconds: input.windowSeconds,
      exemptChannelIds: [...new Set(input.exemptChannelIds)],
      exemptRoleIds: [...new Set(input.exemptRoleIds)],
      allowedDomains: [...new Set((input.allowedDomains || []).map(host => host.toLowerCase()))],
      allowedInviteCodes: [...new Set(input.allowedInviteCodes || [])],
    }));
    this.cache.delete(guildId);
    return saved;
  }

  async setEnabled(guildId: string, ruleId: number, enabled: boolean): Promise<boolean> {
    if (!SNOWFLAKE.test(guildId) || !Number.isSafeInteger(ruleId) ||
        ruleId < 1 || typeof enabled !== 'boolean') {
      throw new BadRequestException('Invalid rule update');
    }
    const result = await this.repo.update({ guildId, id: ruleId }, { enabled });
    this.cache.delete(guildId);
    return (result.affected || 0) > 0;
  }
}
