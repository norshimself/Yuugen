import { RolePanelListener } from './role-panel.listener';
import { RolePanelService } from '../../domain/roles/role-panel.service';
import type { RolePanel } from '../../domain/roles/role-panel.entity';

describe('RolePanelListener: guild-scoped interactive self-roles (#63)', () => {
  const guildId = '123456789012345678';
  const userId = '234567890123456789';
  const channelId = '345678901234567890';
  const messageId = '456789012345678901';
  const blue = '567890123456789012';
  const green = '678901234567890123';
  const prerequisite = '789012345678901234';
  const panel: RolePanel = {
    id: 14, guildId, channelId, messageId, title: 'Choose a role',
    mode: 'buttons', status: 'active', revision: 1,
    options: [
      { id: 1, roleId: blue, label: 'Blue',
        groupKey: 'color', prerequisiteRoleId: null },
      { id: 2, roleId: green, label: 'Green',
        groupKey: 'color', prerequisiteRoleId: prerequisite },
    ],
    createdByUserId: userId, createdAt: new Date(), updatedAt: new Date(),
  };

  function setup() {
    const currentRoles = new Set<string>();
    const roleAdd = jest.fn(async (id: string) => { currentRoles.add(id); });
    const roleRemove = jest.fn(async (id: string) => { currentRoles.delete(id); });
    const member = {
      id: userId, user: { bot: false },
      roles: {
        cache: {
          keys: () => currentRoles.values(),
          has: (id: string) => currentRoles.has(id),
        },
        add: roleAdd, remove: roleRemove,
        set: jest.fn(),
      },
    };
    const bot = {
      id: '890123456789012345',
      permissions: { has: jest.fn().mockReturnValue(true) },
      roles: {
        highest: { comparePositionTo: jest.fn().mockReturnValue(1) },
      },
    };
    const guild: any = {
      id: guildId, ownerId: '999999999999999999',
      members: {
        fetch: jest.fn().mockResolvedValue(member),
        fetchMe: jest.fn().mockResolvedValue(bot),
      },
    };
    const rolesById = new Map<string, any>();
    for (const id of [blue, green, prerequisite]) {
      rolesById.set(id, {
        id, guild, managed: false, manageable: true,
        permissions: { bitfield: 0n },
      });
    }
    guild.roles = {
      fetch: jest.fn(async (id: string) => rolesById.get(id) || null),
    };
    const action = {
      id: '987654321098765432',
      isButton: () => true,
      isStringSelectMenu: () => false,
      customId: 'yrole:b:14:1:1',
      guildId, guild, channelId,
      message: { id: messageId }, user: { id: userId },
      deferred: false, replied: false,
      deferReply: jest.fn().mockImplementation(async function () {
        action.deferred = true;
      }),
      editReply: jest.fn().mockResolvedValue(undefined),
    };
    const service = {
      getPanel: jest.fn().mockResolvedValue(panel),
      acquireMember: jest.fn().mockResolvedValue({
        token: '11111111-1111-4111-8111-111111111111', coolingDown: false,
      }),
      releaseMember: jest.fn().mockResolvedValue(undefined),
      hasMemberLease: jest.fn().mockResolvedValue(true),
      beginAction: jest.fn().mockResolvedValue(33),
      finishAction: jest.fn().mockResolvedValue(true),
    };
    return {
      action, guild, member, bot, service, currentRoles, roleAdd,
      roleRemove, rolesById,
      listener: new RolePanelListener(service as unknown as RolePanelService),
    };
  }

  it('ignores unrelated interaction types and does not query the database', async () => {
    const x = setup();
    x.action.customId = 'other:button';
    await x.listener.onInteraction(x.action as any);
    expect(x.service.getPanel).not.toHaveBeenCalled();
    expect(x.action.deferReply).not.toHaveBeenCalled();
  });

  it('rejects disabled panels and copied controls with another message ID', async () => {
    const x = setup();
    x.service.getPanel.mockResolvedValueOnce({ ...panel, status: 'disabled' });
    await x.listener.onInteraction(x.action as any);
    expect(x.roleAdd).not.toHaveBeenCalled();
    expect(x.service.acquireMember).not.toHaveBeenCalled();
    const y = setup();
    y.action.message.id = '999999999999999999';
    await y.listener.onInteraction(y.action as any);
    expect(y.roleAdd).not.toHaveBeenCalled();
    expect(y.action.editReply).toHaveBeenCalledWith(
      expect.stringContaining('disabled, stale'),
    );
  });

  it('rejects stale revisions, wrong channels, and cross-guild replay', async () => {
    const x = setup();
    x.action.customId = 'yrole:b:14:0:1';
    await x.listener.onInteraction(x.action as any);
    expect(x.service.acquireMember).not.toHaveBeenCalled();

    const y = setup();
    y.action.channelId = '999999999999999999';
    await y.listener.onInteraction(y.action as any);
    expect(y.service.acquireMember).not.toHaveBeenCalled();

    const z = setup();
    z.action.guildId = '999999999999999999';
    await z.listener.onInteraction(z.action as any);
    expect(z.service.acquireMember).not.toHaveBeenCalled();
  });

  it('adds only the selected safe role after a unique audit is reserved', async () => {
    const x = setup();
    await x.listener.onInteraction(x.action as any);
    expect(x.service.beginAction).toHaveBeenCalledWith(
      x.action.id, guildId, userId, 14, 1, blue,
    );
    expect(x.roleAdd).toHaveBeenCalledWith(blue, 'Yuugen self-role selection');
    expect(x.roleRemove).not.toHaveBeenCalled();
    expect(x.member.roles.set).not.toHaveBeenCalled();
    expect(x.service.finishAction).toHaveBeenCalledWith(guildId, 33, 'added');
    expect(x.service.releaseMember).toHaveBeenCalledWith(
      guildId, userId, expect.any(String), true,
    );
  });

  it('removes a selected already-held role without mutating unrelated roles', async () => {
    const x = setup();
    x.currentRoles.add(blue);
    x.currentRoles.add('999999999999999999');
    await x.listener.onInteraction(x.action as any);
    expect(x.roleRemove).toHaveBeenCalledTimes(1);
    expect(x.roleRemove).toHaveBeenCalledWith(blue, 'Yuugen self-role removal');
    expect(x.currentRoles.has('999999999999999999')).toBe(true);
    expect(x.service.finishAction).toHaveBeenCalledWith(guildId, 33, 'removed');
  });

  it('enforces a role prerequisite before any audit or mutation', async () => {
    const x = setup();
    x.action.customId = 'yrole:b:14:1:2';
    await x.listener.onInteraction(x.action as any);
    expect(x.action.editReply).toHaveBeenCalledWith(
      expect.stringContaining('prerequisite'),
    );
    expect(x.service.beginAction).not.toHaveBeenCalled();
    expect(x.roleAdd).not.toHaveBeenCalled();
  });

  it('replaces exclusive-group peers after adding the requested role', async () => {
    const x = setup();
    x.currentRoles.add(blue);
    x.currentRoles.add(prerequisite);
    x.action.customId = 'yrole:b:14:1:2';
    await x.listener.onInteraction(x.action as any);
    expect(x.roleAdd).toHaveBeenCalledWith(green, 'Yuugen self-role selection');
    expect(x.roleRemove).toHaveBeenCalledWith(blue, 'Yuugen exclusive role group');
    expect(x.currentRoles.has(green)).toBe(true);
    expect(x.currentRoles.has(blue)).toBe(false);
    expect(x.currentRoles.has(prerequisite)).toBe(true);
    expect(x.service.finishAction).toHaveBeenCalledWith(guildId, 33, 'added');
  });

  it('accepts a dropdown selection only from the original published message', async () => {
    const x = setup();
    x.service.getPanel.mockResolvedValue({ ...panel, mode: 'select' });
    x.action.isButton = () => false;
    x.action.isStringSelectMenu = () => true;
    x.action.customId = 'yrole:s:14:1';
    (x.action as any).values = ['1'];
    await x.listener.onInteraction(x.action as any);
    expect(x.roleAdd).toHaveBeenCalledWith(blue, expect.any(String));
    expect(x.service.finishAction).toHaveBeenCalledWith(guildId, 33, 'added');
  });

  it('rejects missing roles and privileged role permission changes at click time', async () => {
    const x = setup();
    x.rolesById.delete(blue);
    await x.listener.onInteraction(x.action as any);
    expect(x.roleAdd).not.toHaveBeenCalled();
    const y = setup();
    y.rolesById.get(blue).permissions.bitfield = 1n << 3n;
    await y.listener.onInteraction(y.action as any);
    expect(y.roleAdd).not.toHaveBeenCalled();
    expect(y.action.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Privileged'),
    );
  });

  it('rejects bot hierarchy changes and missing Manage Roles permission', async () => {
    const x = setup();
    x.bot.roles.highest.comparePositionTo.mockReturnValue(0);
    await x.listener.onInteraction(x.action as any);
    expect(x.roleAdd).not.toHaveBeenCalled();
    const y = setup();
    y.bot.permissions.has.mockReturnValue(false);
    await y.listener.onInteraction(y.action as any);
    expect(y.roleAdd).not.toHaveBeenCalled();
  });

  it('rejects another ongoing member mutation or a recent cooldown', async () => {
    const x = setup();
    x.service.acquireMember.mockResolvedValue(null);
    await x.listener.onInteraction(x.action as any);
    expect(x.service.beginAction).not.toHaveBeenCalled();

    const y = setup();
    y.service.acquireMember.mockResolvedValue({
      token: '11111111-1111-4111-8111-111111111111', coolingDown: true,
    });
    await y.listener.onInteraction(y.action as any);
    expect(y.roleAdd).not.toHaveBeenCalled();
    expect(y.service.releaseMember).toHaveBeenCalledWith(
      guildId, userId, expect.any(String), false,
    );
  });

  it('deduplicates a repeated Discord interaction ID before role mutation', async () => {
    const x = setup();
    x.service.beginAction.mockResolvedValue(null);
    await x.listener.onInteraction(x.action as any);
    expect(x.roleAdd).not.toHaveBeenCalled();
    expect(x.service.releaseMember).toHaveBeenCalled();
  });

  it('fails closed when lease expires before any Discord role call', async () => {
    const x = setup();
    x.service.hasMemberLease.mockResolvedValue(false);
    await x.listener.onInteraction(x.action as any);
    expect(x.roleAdd).not.toHaveBeenCalled();
    expect(x.service.finishAction).toHaveBeenCalledWith(guildId, 33, 'denied');
  });

  it('refuses a role change when staff disables the panel after audit reservation', async () => {
    const x = setup();
    x.service.getPanel
      .mockResolvedValueOnce(panel)
      .mockResolvedValueOnce(panel)
      .mockResolvedValueOnce({ ...panel, status: 'disabled' });
    await x.listener.onInteraction(x.action as any);
    expect(x.service.beginAction).toHaveBeenCalled();
    expect(x.roleAdd).not.toHaveBeenCalled();
    expect(x.service.finishAction).toHaveBeenCalledWith(guildId, 33, 'denied');
  });

  it('never blindly retries an ambiguous Discord role addition', async () => {
    const x = setup();
    x.roleAdd.mockRejectedValueOnce(new Error('network response unknown'));
    await x.listener.onInteraction(x.action as any);
    expect(x.roleAdd).toHaveBeenCalledTimes(1);
    expect(x.roleRemove).not.toHaveBeenCalled();
    expect(x.service.finishAction).toHaveBeenCalledWith(guildId, 33, 'uncertain');
    expect(x.service.releaseMember).toHaveBeenCalledWith(
      guildId, userId, expect.any(String), true,
    );
  });

  it('audits partial exclusive-group removal without unsafe automated rollback', async () => {
    const x = setup();
    x.currentRoles.add(blue);
    x.currentRoles.add(prerequisite);
    x.action.customId = 'yrole:b:14:1:2';
    x.roleRemove.mockRejectedValueOnce(new Error('channel role changed'));
    await x.listener.onInteraction(x.action as any);
    expect(x.roleAdd).toHaveBeenCalledTimes(1);
    expect(x.roleRemove).toHaveBeenCalledTimes(1);
    expect(x.service.finishAction).toHaveBeenCalledWith(guildId, 33, 'partial');
    expect(x.action.editReply).toHaveBeenCalledWith(expect.stringContaining('Staff'));
  });
});
