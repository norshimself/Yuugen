import { RolePanelService } from './role-panel.service';
import type { RolePanel } from './role-panel.entity';

describe('RolePanelService: concurrency, persistence and audit (#63)', () => {
  const guildId = '123456789012345678';
  const otherGuildId = '345678901234567890';
  const userId = '234567890123456789';
  const roleId = '456789012345678901';
  const option = {
    id: 1, roleId, label: 'News', groupKey: null, prerequisiteRoleId: null,
  };
  const draft: RolePanel = {
    id: 14, guildId, channelId: '567890123456789012', messageId: null,
    title: 'Choose a role', createdByUserId: userId,
    mode: 'buttons', status: 'draft', revision: 0,
    options: [option], createdAt: new Date(), updatedAt: new Date(),
  };

  function builder(row: any = draft) {
    return {
      insert: jest.fn().mockReturnThis(), into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(), orIgnore: jest.fn().mockReturnThis(),
      update: jest.fn().mockReturnThis(), set: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(), returning: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({ raw: [row] }),
    };
  }

  function setup() {
    const edit = builder({ ...draft, revision: 1, options: [option] });
    const publish = builder({ ...draft, status: 'publishing' });
    const disable = builder({ ...draft, status: 'disabled' });
    const actionInsert = builder({ id: 33 });
    const lockUpdate = builder(null);
    const panels = {
      findOne: jest.fn().mockResolvedValue(draft),
      find: jest.fn().mockResolvedValue([draft]),
      count: jest.fn().mockResolvedValue(1),
      create: jest.fn((v: unknown) => v),
      save: jest.fn(async (v: unknown) => v),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      createQueryBuilder: jest.fn().mockReturnValue(edit),
    };
    const locks = {
      query: jest.fn().mockResolvedValue([{ lastActionAt: null }]),
      findOne: jest.fn().mockResolvedValue({
        guildId, userId, token: 'a', expiresAt: new Date(Date.now() + 60000),
      }),
      createQueryBuilder: jest.fn().mockReturnValue(lockUpdate),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const actions = {
      createQueryBuilder: jest.fn().mockReturnValue(actionInsert),
      update: jest.fn().mockResolvedValue({ affected: 1 }),
      delete: jest.fn().mockResolvedValue({ affected: 0 }),
    };
    const service = new RolePanelService(panels as any, locks as any, actions as any);
    return {
      service, panels, locks, actions, edit, publish, disable,
      actionInsert, lockUpdate,
    };
  }

  it('scopes draft/list operations to the requested Discord guild', async () => {
    const x = setup();
    await x.service.getPanel(guildId, 14);
    expect(x.panels.findOne).toHaveBeenCalledWith({
      where: { guildId, id: 14 },
    });
    await x.service.listPanels(otherGuildId);
    expect(x.panels.find).toHaveBeenCalledWith({
      where: { guildId: otherGuildId },
      order: { id: 'DESC' }, take: 20,
    });
  });

  it('creates a nonpublished draft only after validating title, guild and quota', async () => {
    const x = setup();
    await x.service.createDraft(guildId, draft.channelId, userId, 'Roles', 'buttons');
    expect(x.panels.save).toHaveBeenCalledWith(expect.objectContaining({
      guildId, channelId: draft.channelId, mode: 'buttons',
      status: 'draft', messageId: null, revision: 0,
    }));
    await expect(x.service.createDraft(guildId, draft.channelId, userId,
      'bad\nname', 'buttons')).rejects.toThrow('Invalid role panel');
    x.panels.count.mockResolvedValueOnce(20);
    await expect(x.service.createDraft(guildId, draft.channelId, userId,
      'Roles', 'buttons')).rejects.toThrow('too many');
  });

  it('uses compare-and-swap revision to reject simultaneous draft updates', async () => {
    const x = setup();
    const result = await x.service.addOption(
      guildId, 14, '678901234567890123', 'Green', 'color', null,
    );
    expect(result.revision).toBe(1);
    expect(x.edit.set).toHaveBeenCalledWith(expect.objectContaining({
      revision: 1,
      options: expect.arrayContaining([
        expect.objectContaining({ roleId: '678901234567890123', id: 2 }),
      ]),
    }));
    expect(x.edit.where).toHaveBeenCalledWith(
      expect.stringContaining('"revision" = :revision'),
      expect.objectContaining({ guildId, id: 14, revision: 0, status: 'draft' }),
    );
    x.edit.execute.mockResolvedValue({ raw: [] });
    await expect(x.service.addOption(
      guildId, 14, '678901234567890123', 'Green', null, null,
    )).rejects.toThrow('Panel changed');
  });

  it('rejects invalid and duplicate draft options, and only removes existing IDs', async () => {
    const x = setup();
    await expect(x.service.addOption(guildId, 14, roleId,
      'Copy', null, null)).rejects.toThrow('Duplicate');
    await expect(x.service.addOption(guildId, 14, '678901234567890123',
      'Copy', '@everyone', null)).rejects.toThrow('Invalid option');
    await expect(x.service.removeOption(guildId, 14, 999))
      .rejects.toThrow('not found');
    await x.service.removeOption(guildId, 14, 1);
    expect(x.edit.set).toHaveBeenCalledWith(expect.objectContaining({
      options: [], revision: 1,
    }));
  });

  it('does not edit published or disabled panels', async () => {
    const x = setup();
    x.panels.findOne.mockResolvedValue({ ...draft, status: 'active' });
    await expect(x.service.addOption(guildId, 14, '678901234567890123',
      'Green', null, null)).rejects.toThrow('Only draft');
    await expect(x.service.removeOption(guildId, 14, 1))
      .rejects.toThrow('Only valid draft');
    await expect(x.service.beginPublish(guildId, 14))
      .rejects.toThrow('unpublished panel');
  });

  it('reserves a single publish before an external Discord send', async () => {
    const x = setup();
    x.panels.createQueryBuilder.mockReturnValue(x.publish);
    const row = await x.service.beginPublish(guildId, 14);
    expect(row.status).toBe('publishing');
    expect(x.publish.set).toHaveBeenCalledWith({ status: 'publishing' });
    expect(x.publish.where).toHaveBeenCalledWith(
      expect.stringContaining('"revision" = :revision'),
      expect.objectContaining({ guildId, id: 14, revision: 0 }),
    );
    x.publish.execute.mockResolvedValue({ raw: [] });
    await expect(x.service.beginPublish(guildId, 14))
      .rejects.toThrow('Another staff');
  });

  it('activates only a reserved publish with the real Discord message ID', async () => {
    const x = setup();
    expect(await x.service.activate(guildId, 14, '678901234567890123'))
      .toBe(true);
    expect(x.panels.update).toHaveBeenCalledWith(
      { guildId, id: 14, status: 'publishing' },
      { status: 'active', messageId: '678901234567890123' },
    );
    x.panels.update.mockResolvedValueOnce({ affected: 0 });
    expect(await x.service.activate(guildId, 14, '678901234567890123'))
      .toBe(false);
    await expect(x.service.activate(guildId, 14, 'bad')).rejects.toThrow('message');
  });

  it('disables any lifecycle state atomically without removing member roles', async () => {
    const x = setup();
    x.panels.createQueryBuilder.mockReturnValue(x.disable);
    expect((await x.service.disable(guildId, 14))?.status).toBe('disabled');
    expect(x.disable.where).toHaveBeenCalledWith(
      expect.stringContaining('"guildId" = :guildId'),
      expect.objectContaining({ guildId, id: 14, status: 'draft' }),
    );
    expect(x.panels.update).not.toHaveBeenCalled();
  });

  it('acquires the same guild/member lock only once per active lease', async () => {
    const x = setup();
    const a = await x.service.acquireMember(guildId, userId);
    expect(a?.token).toMatch(/^[a-f0-9-]{36}$/);
    expect(a?.coolingDown).toBe(false);
    expect(x.locks.query).toHaveBeenCalledWith(
      expect.stringContaining('ON CONFLICT ("guildId","userId")'),
      expect.arrayContaining([guildId, userId, a?.token]),
    );
    x.locks.query.mockResolvedValueOnce([]);
    expect(await x.service.acquireMember(guildId, userId)).toBeNull();
  });

  it('enforces a cross-restart member cooldown and prevents stale unlocks', async () => {
    const x = setup();
    x.locks.query.mockResolvedValue([{
      lastActionAt: new Date(Date.now() - 100),
    }]);
    expect((await x.service.acquireMember(guildId, userId))?.coolingDown)
      .toBe(true);
    await x.service.releaseMember(guildId, userId,
      '11111111-1111-4111-8111-111111111111', true);
    expect(x.lockUpdate.where).toHaveBeenCalledWith(
      expect.stringContaining('"token" = :token'),
      expect.objectContaining({ guildId, userId }),
    );
    expect(x.lockUpdate.set).toHaveBeenCalledWith(expect.objectContaining({
      token: null, lastActionAt: expect.any(Date),
    }));
  });

  it('verifies a current lease before permitting another role mutation', async () => {
    const x = setup();
    expect(await x.service.hasMemberLease(guildId, userId, 'a')).toBe(true);
    x.locks.findOne.mockResolvedValueOnce({
      expiresAt: new Date(Date.now() - 3000),
    });
    expect(await x.service.hasMemberLease(guildId, userId, 'a')).toBe(false);
    expect(await x.service.hasMemberLease('bad', userId, 'a')).toBe(false);
  });

  it('audits a unique Discord interaction before mutating any role', async () => {
    const x = setup();
    expect(await x.service.beginAction(
      '678901234567890123', guildId, userId, 14, 1, roleId,
    )).toBe(33);
    expect(x.actionInsert.orIgnore).toHaveBeenCalled();
    expect(x.actionInsert.values).toHaveBeenCalledWith({
      interactionId: '678901234567890123',
      guildId, userId, panelId: 14, optionId: 1, roleId,
      status: 'pending',
    });
    x.actionInsert.execute.mockResolvedValueOnce({ raw: [] });
    expect(await x.service.beginAction(
      '678901234567890123', guildId, userId, 14, 1, roleId,
    )).toBeNull();
  });

  it('records only a pending guild-scoped action outcome, including partial writes', async () => {
    const x = setup();
    await x.service.finishAction(guildId, 33, 'partial');
    expect(x.actions.update).toHaveBeenCalledWith(
      { guildId, id: 33, status: 'pending' }, { status: 'partial' },
    );
    await expect(x.service.finishAction(guildId, 33, 'success' as any))
      .rejects.toThrow('Invalid role action');
  });

  it('runs opportunistic privacy cleanup for old action audits, not active panels', async () => {
    const x = setup();
    await x.service.beginAction(
      '678901234567890123', guildId, userId, 14, 1, roleId,
    );
    expect(x.actions.delete).toHaveBeenCalledWith({
      guildId, createdAt: expect.anything(),
    });
    expect(x.locks.delete).toHaveBeenCalledWith(expect.objectContaining({
      guildId, expiresAt: expect.anything(),
    }));
    await x.service.beginAction(
      '678901234567890124', guildId, userId, 14, 1, roleId,
    );
    expect(x.actions.delete).toHaveBeenCalledTimes(1);
  });
});
