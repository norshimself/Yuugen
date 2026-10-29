import { VerificationService } from './verification.service';
import type { GuildVerificationConfig } from './guild-verification-config.entity';

describe('VerificationService: durable sessions and action audit (#64)', () => {
  const guildId = '123456789012345678';
  const userId = '234567890123456789';
  const roleId = '345678901234567890';
  const channelId = '456789012345678901';
  const now = 1800000000000;
  const sessionKey = String(now);
  const config: GuildVerificationConfig = {
    guildId, channelId, quarantineRoleId: roleId, messageId: '567890123456789012',
    mode: 'button', status: 'active', revision: 2,
    questionPrompt: null, answerSalt: null, answerDigest: null,
    updatedByUserId: userId, createdAt: new Date(), updatedAt: new Date(),
  };
  function queryBuilder(row: unknown = null) {
    return {
      update: jest.fn().mockReturnThis(),
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: row ? [row] : [] }),
    };
  }
  function setup() {
    const configUpdate = queryBuilder({ ...config, revision: 3, status: 'draft' });
    const sessionUpdate = queryBuilder({
      sessionKey, quarantineRoleId: roleId, wrongAnswers: 1,
    });
    const actionInsert = queryBuilder({ id: 23 });
    const configs = {
      findOne: jest.fn().mockResolvedValue(config),
      create: jest.fn((x: unknown) => x),
      save: jest.fn(async (x: unknown) => x),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(configUpdate),
    };
    const sessions = {
      findOne: jest.fn().mockResolvedValue({
        guildId, userId, sessionKey, quarantineRoleId: roleId,
        status: 'quarantined', wrongAnswers: 0,
      }),
      count: jest.fn().mockResolvedValue(0),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      query: jest.fn().mockResolvedValue([{ sessionKey }]),
      createQueryBuilder: jest.fn().mockReturnValue(sessionUpdate),
    };
    const actions = {
      find: jest.fn().mockResolvedValue([]),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
      createQueryBuilder: jest.fn().mockReturnValue(actionInsert),
    };
    return {
      service: new VerificationService(configs as any, sessions as any, actions as any),
      configs, sessions, actions, configUpdate, sessionUpdate, actionInsert,
    };
  }

  it('reads guild-scoped configuration without exposing another guild row', async () => {
    const x = setup();
    await x.service.getConfig(guildId);
    expect(x.configs.findOne).toHaveBeenCalledWith({ where: { guildId } });
    expect((await x.service.activeConfig(guildId))?.status).toBe('active');
    x.configs.findOne.mockResolvedValueOnce({ ...config, status: 'disabled' });
    expect(await x.service.activeConfig(guildId)).toBeNull();
  });

  it('blocks self-role menus for current unverified and unobserved members', async () => {
    const x = setup();
    expect(await x.service.isRestricted(guildId, userId, now)).toBe(true);
    x.sessions.findOne.mockResolvedValue(null);
    expect(await x.service.isRestricted(guildId, userId, now)).toBe(true);
    expect(await x.service.isRestricted(guildId, userId, now + 5000)).toBe(true);
  });

  it('allows a verified current-session member, even with verification disabled', async () => {
    const x = setup();
    x.sessions.findOne.mockResolvedValue({
      guildId, userId, sessionKey, status: 'released',
    });
    expect(await x.service.isRestricted(guildId, userId, now)).toBe(false);
    x.configs.findOne.mockResolvedValue({ ...config, status: 'disabled' });
    x.sessions.findOne.mockResolvedValue({ ...config,
      sessionKey, status: 'quarantined' });
    expect(await x.service.isRestricted(guildId, userId, now)).toBe(true);
  });

  it('blocks re-applied quarantine roles even after a database release', async () => {
    const x = setup();
    x.sessions.findOne.mockResolvedValue({
      guildId, userId, sessionKey, status: 'released', quarantineRoleId: roleId,
    });
    expect(await x.service.isRestricted(
      guildId, userId, now, new Set([roleId]),
    )).toBe(true);
    expect(await x.service.isRestricted(
      guildId, userId, now, new Set(),
    )).toBe(false);
  });

  it('keeps a rejoined member restricted until the newer session is handled', async () => {
    const x = setup();
    x.sessions.findOne.mockResolvedValue({
      sessionKey, status: 'released',
    });
    expect(await x.service.isRestricted(guildId, userId, now + 10000)).toBe(true);
  });

  it('creates only a disabled draft with no plaintext challenge answer', async () => {
    const x = setup();
    x.configs.findOne.mockResolvedValue(null);
    await x.service.setup(
      guildId, channelId, roleId, userId, 'question', 'Server keyword?', 'secret',
    );
    const payload = x.configs.save.mock.calls[0][0];
    expect(payload).toEqual(expect.objectContaining({
      guildId, channelId, quarantineRoleId: roleId, status: 'draft', revision: 1,
      questionPrompt: 'Server keyword?',
      answerSalt: expect.stringMatching(/^[0-9a-f]{32}$/),
      answerDigest: expect.stringMatching(/^[0-9a-f]{64}$/),
    }));
    expect(JSON.stringify(payload)).not.toContain('secret');
    expect(x.service.answerMatches(payload, 'SECRET')).toBe(true);
  });

  it('refuses invalid challenge modes and incomplete question prompts', async () => {
    const x = setup();
    await expect(x.service.setup(guildId, channelId, roleId, userId,
      'question', 'Question?', '')).rejects.toThrow('Invalid verification answer');
    await expect(x.service.setup(guildId, channelId, roleId, userId,
      'question', 'x'.repeat(46), 'answer')).rejects.toThrow('1-45');
    await expect(x.service.setup(guildId, channelId, roleId, userId,
      'bad' as any)).rejects.toThrow('Invalid');
  });

  it('allows reconfiguration only after a disabled revision compare-and-swap', async () => {
    const x = setup();
    await expect(x.service.setup(guildId, channelId, roleId, userId,
      'button')).rejects.toThrow('Disable');
    x.configs.findOne.mockResolvedValue({ ...config, status: 'disabled' });
    const changed = await x.service.setup(guildId, channelId, roleId, userId,
      'button');
    expect(changed.revision).toBe(3);
    expect(x.configUpdate.where).toHaveBeenCalledWith(
      expect.stringContaining('"revision" = :revision'),
      expect.objectContaining({
        guildId, status: 'disabled', revision: 2,
      }),
    );
  });

  it('reserves publication, activates a real message ID and disables safely', async () => {
    const x = setup();
    x.configs.findOne.mockResolvedValue({ ...config, status: 'draft' });
    x.configUpdate.execute.mockResolvedValue({
      raw: [{ ...config, status: 'publishing' }],
    });
    expect((await x.service.beginPublish(guildId)).status).toBe('publishing');
    expect(x.configUpdate.set).toHaveBeenCalledWith({ status: 'publishing' });
    expect(await x.service.activate(
      guildId, 2, '678901234567890123',
    )).toBe(true);
    expect(x.configs.update).toHaveBeenCalledWith(
      { guildId, revision: 2, status: 'publishing' },
      { status: 'active', messageId: '678901234567890123' },
    );
    expect((await x.service.disable(guildId))?.status).toBe('publishing');
  });

  it('deduplicates join events and refuses disabled or older sessions at SQL boundary', async () => {
    const x = setup();
    expect(await x.service.claimJoin(guildId, userId, sessionKey, roleId))
      .toMatch(/^[0-9a-f-]{36}$/);
    const statement = x.sessions.query.mock.calls[0][0];
    expect(statement).toContain('ON CONFLICT ("guildId","userId")');
    expect(statement).toContain('"status" = \'active\'');
    expect(statement).toContain('::bigint');
    expect(x.sessions.query.mock.calls[0][1]).toEqual([
      guildId, userId, sessionKey, roleId, expect.any(String),
    ]);
    x.sessions.query.mockResolvedValueOnce([]);
    expect(await x.service.claimJoin(guildId, userId, sessionKey, roleId))
      .toBeNull();
    expect(await x.service.claimJoin(guildId, userId, 'invalid', roleId))
      .toBeNull();
  });

  it('finalizes only the claimed current join with status guard', async () => {
    const x = setup();
    const token = '11111111-1111-4111-8111-111111111111';
    expect(await x.service.finishJoin(guildId, userId, sessionKey, token,
      'quarantined')).toBe(true);
    expect(x.sessions.update).toHaveBeenCalledWith(
      { guildId, userId, sessionKey, claimToken: token, status: 'join_pending' },
      { status: 'quarantined', claimToken: null },
    );
  });

  it('makes staff overrides rejoin-safe and never overwrites newer membership', async () => {
    const x = setup();
    await x.service.prepareOverride(guildId, userId, sessionKey, roleId);
    const query = x.sessions.query.mock.calls[0][0];
    expect(query).toContain('ON CONFLICT ("guildId","userId")');
    expect(query).toContain('::bigint');
    expect(query).toContain('WHERE');
    expect(x.sessions.query.mock.calls[0][1])
      .toEqual([guildId, userId, sessionKey, roleId]);
  });

  it('claims only eligible release states and bounds question retries', async () => {
    const x = setup();
    const claim = await x.service.claimRelease(
      guildId, userId, sessionKey, false,
    );
    expect(claim?.token).toMatch(/^[0-9a-f-]{36}$/);
    expect(claim?.roleId).toBe(roleId);
    expect(x.sessionUpdate.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('"wrongAnswers" < :limit'),
      { limit: 5 },
    );
    await x.service.claimRelease(guildId, userId, sessionKey, true);
    expect(x.sessionUpdate.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('IN (:...statuses)'),
      expect.objectContaining({ statuses: expect.arrayContaining(['join_uncertain']) }),
    );
  });

  it('records only one conditional release outcome and no new role assignments', async () => {
    const x = setup();
    const token = '11111111-1111-4111-8111-111111111111';
    expect(await x.service.finishRelease(
      guildId, userId, sessionKey, token, 'released',
    )).toBe(true);
    expect(x.sessions.update).toHaveBeenCalledWith(
      { guildId, userId, sessionKey, status: 'release_pending', claimToken: token },
      { status: 'released', claimToken: null, releasedAt: expect.any(Date) },
    );
  });

  it('increments incorrect answer count only for the current quarantined session', async () => {
    const x = setup();
    expect(await x.service.countWrongAnswer(guildId, userId, sessionKey)).toBe(1);
    expect(x.sessionUpdate.set).toHaveBeenCalledWith({
      wrongAnswers: expect.any(Function),
    });
    expect(x.sessionUpdate.andWhere).toHaveBeenCalledWith(
      expect.stringContaining('"wrongAnswers" < :max'),
      { status: 'quarantined', max: 5 },
    );
    x.sessionUpdate.execute.mockResolvedValueOnce({ raw: [] });
    expect(await x.service.countWrongAnswer(guildId, userId, sessionKey)).toBeNull();
  });

  it('uniquely journals join and verification interactions before a role mutation', async () => {
    const x = setup();
    const interaction = '678901234567890123';
    expect(await x.service.beginAction(
      guildId, interaction, userId, userId, sessionKey, 'verify',
    )).toBe(23);
    expect(x.actionInsert.orIgnore).toHaveBeenCalled();
    expect(x.actionInsert.values).toHaveBeenCalledWith({
      guildId, eventKey: interaction, userId, actorId: userId,
      sessionKey, action: 'verify', status: 'pending',
    });
    x.actionInsert.execute.mockResolvedValueOnce({ raw: [] });
    expect(await x.service.beginAction(
      guildId, interaction, userId, userId, sessionKey, 'verify',
    )).toBeNull();
    expect(await x.service.beginAction(
      guildId, 'join:' + userId + ':' + sessionKey,
      userId, userId, sessionKey, 'join',
    )).toBe(23);
  });

  it('guards guild-scoped action completion and shows only retention-valid history', async () => {
    const x = setup();
    expect(await x.service.finishAction(guildId, 23, 'succeeded')).toBe(true);
    expect(x.actions.update).toHaveBeenCalledWith(
      { guildId, id: 23, status: 'pending' },
      { status: 'succeeded' },
    );
    await expect(x.service.finishAction(guildId, 23,
      'raw_answer' as any)).rejects.toThrow('Invalid verification');
    await x.service.recentActions(guildId);
    expect(x.actions.find).toHaveBeenCalledWith({
      where: { guildId, createdAt: expect.anything() },
      order: { createdAt: 'DESC', id: 'DESC' }, take: 20,
    });
  });

  it('prunes only metadata action audits and leaves active sessions intact', async () => {
    const x = setup();
    await x.service.purgeExpiredAudit(guildId);
    expect(x.actions.delete).toHaveBeenCalledWith({
      guildId, createdAt: expect.anything(),
    });
    await x.service.purgeExpiredAudit(guildId);
    expect(x.actions.delete).toHaveBeenCalledTimes(1);
    expect(x.sessions.update).not.toHaveBeenCalled();
  });
});
