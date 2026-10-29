import { ChannelType, PermissionFlagsBits } from 'discord.js';
import { RolePanelCommands } from './role-panel.command';
import type { RolePanel } from '../../../domain/roles/role-panel.entity';

describe('/role panel staff management (#63)', () => {
  const guildId = '123456789012345678';
  const actorId = '234567890123456789';
  const channelId = '345678901234567890';
  const roleId = '456789012345678901';
  const panel: RolePanel = {
    id: 17, guildId, channelId, messageId: null,
    title: 'Choose a role', mode: 'buttons', status: 'draft', revision: 1,
    options: [{ id: 1, roleId, label: 'Green', groupKey: null, prerequisiteRoleId: null }],
    createdByUserId: actorId, createdAt: new Date(), updatedAt: new Date(),
  };

  function setup() {
    const message = {
      id: '567890123456789012',
      edit: jest.fn().mockResolvedValue(undefined),
    };
    const channel = {
      id: channelId, guildId, type: ChannelType.GuildText as ChannelType,
      permissionsFor: jest.fn().mockReturnValue({
        has: jest.fn().mockReturnValue(true),
      }),
      send: jest.fn().mockResolvedValue(message),
      messages: { fetch: jest.fn().mockResolvedValue(message) },
    };
    const manager = {
      id: actorId, permissions: { has: jest.fn().mockReturnValue(true) },
      roles: { highest: { comparePositionTo: jest.fn().mockReturnValue(1) } },
    };
    const bot = {
      id: '678901234567890123',
      permissions: { has: jest.fn().mockReturnValue(true) },
      roles: { highest: { comparePositionTo: jest.fn().mockReturnValue(1) } },
    };
    const guild: any = {
      id: guildId,
      ownerId: '999999999999999999',
      members: {
        fetch: jest.fn().mockResolvedValue(manager),
        fetchMe: jest.fn().mockResolvedValue(bot),
      },
      channels: {
        fetch: jest.fn().mockResolvedValue(channel),
      },
    };
    const role = {
      id: roleId, guild, managed: false, manageable: true,
      permissions: { bitfield: 0n },
    };
    guild.roles = { fetch: jest.fn().mockResolvedValue(role) };
    const commandsService = {
      getPanel: jest.fn().mockResolvedValue(panel),
      createDraft: jest.fn().mockResolvedValue(panel),
      addOption: jest.fn().mockResolvedValue(panel),
      removeOption: jest.fn().mockResolvedValue({ ...panel, options: [] }),
      listPanels: jest.fn().mockResolvedValue([panel]),
      beginPublish: jest.fn().mockResolvedValue({ ...panel, status: 'publishing' }),
      activate: jest.fn().mockResolvedValue(true),
      disable: jest.fn().mockResolvedValue({ ...panel, messageId: message.id, status: 'disabled' }),
    };
    const interaction = {
      guild, guildId, user: { id: actorId },
      deferReply: jest.fn().mockResolvedValue({}),
      editReply: jest.fn().mockResolvedValue({}),
    };
    return {
      guild, channel, role, bot, manager, message,
      interaction, service: commandsService,
      commands: new RolePanelCommands(commandsService as any),
    };
  }

  it('enforces Manage Server and Manage Roles before creating or listing', async () => {
    const x = setup();
    x.manager.permissions.has.mockReturnValue(false);
    await x.commands.onCreate([x.interaction] as any, {
      channel: x.channel as any, title: 'Roles', mode: 'buttons',
    });
    expect(x.service.createDraft).not.toHaveBeenCalled();
    await x.commands.onList([x.interaction] as any);
    expect(x.service.listPanels).not.toHaveBeenCalled();
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('Manage Server'),
    );
  });

  it('creates only a guild-scoped draft, never posts immediately', async () => {
    const x = setup();
    await x.commands.onCreate([x.interaction] as any, {
      channel: x.channel as any, title: 'Roles', mode: 'select',
    });
    expect(x.service.createDraft).toHaveBeenCalledWith(
      guildId, channelId, actorId, 'Roles', 'select',
    );
    expect(x.channel.send).not.toHaveBeenCalled();
    expect(x.interaction.deferReply).toHaveBeenCalled();
  });

  it('rejects cross-guild channels and unknown panel layout modes', async () => {
    const x = setup();
    await x.commands.onCreate([x.interaction] as any, {
      channel: { ...x.channel, guildId: '999999999999999999' } as any,
      title: 'Roles', mode: 'buttons',
    });
    await x.commands.onCreate([x.interaction] as any, {
      channel: x.channel as any, title: 'Roles', mode: 'unsafe',
    });
    expect(x.service.createDraft).not.toHaveBeenCalled();
  });

  it('checks actual role hierarchy and permission flags before adding options', async () => {
    const x = setup();
    await x.commands.onAdd([x.interaction] as any, {
      panelId: 17, role: x.role as any, label: 'Green',
      groupKey: 'color',
    });
    expect(x.service.addOption).toHaveBeenCalledWith(
      guildId, 17, roleId, 'Green', 'color', null,
    );
    x.manager.roles.highest.comparePositionTo.mockReturnValue(0);
    await x.commands.onAdd([x.interaction] as any, {
      panelId: 17, role: x.role as any, label: 'Green',
    });
    expect(x.service.addOption).toHaveBeenCalledTimes(1);
  });

  it('refuses managed and privileged roles at creation', async () => {
    const x = setup();
    x.role.managed = true;
    await x.commands.onAdd([x.interaction] as any, {
      panelId: 17, role: x.role as any, label: 'Safe',
    });
    expect(x.service.addOption).not.toHaveBeenCalled();
    x.role.managed = false;
    x.role.permissions.bitfield = 1n << 3n;
    await x.commands.onAdd([x.interaction] as any, {
      panelId: 17, role: x.role as any, label: 'Unsafe',
    });
    expect(x.service.addOption).not.toHaveBeenCalled();
  });

  it('requires a real prerequisite role in the same guild', async () => {
    const x = setup();
    x.guild.roles.fetch
      .mockResolvedValueOnce(x.role)
      .mockResolvedValueOnce(null);
    await x.commands.onAdd([x.interaction] as any, {
      panelId: 17, role: x.role as any, label: 'Green',
      prerequisite: { id: '567890123456789012' } as any,
    });
    expect(x.service.addOption).not.toHaveBeenCalled();
  });

  it('removes draft-only options and lists published configuration safely', async () => {
    const x = setup();
    await x.commands.onRemove([x.interaction] as any, {
      panelId: 17, optionId: 1,
    });
    expect(x.service.removeOption).toHaveBeenCalledWith(guildId, 17, 1);
    await x.commands.onList([x.interaction] as any);
    expect(x.service.listPanels).toHaveBeenCalledWith(guildId);
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.objectContaining({ allowedMentions: { parse: [] } }),
    );
  });

  it('publishes only after live bot/channel/role permission revalidation', async () => {
    const x = setup();
    await x.commands.onPublish([x.interaction] as any, { panelId: 17 });
    expect(x.service.beginPublish).toHaveBeenCalledWith(guildId, 17);
    expect(x.channel.send).toHaveBeenCalledTimes(1);
    expect(x.channel.send).toHaveBeenCalledWith(expect.objectContaining({
      allowedMentions: { parse: [] },
      components: expect.arrayContaining([expect.anything()]),
    }));
    expect(x.service.activate).toHaveBeenCalledWith(
      guildId, 17, x.message.id,
    );
  });

  it('does not publish if bot loses channel rights or a target role was deleted', async () => {
    const x = setup();
    x.channel.permissionsFor.mockReturnValue({
      has: jest.fn().mockReturnValue(false),
    });
    await x.commands.onPublish([x.interaction] as any, { panelId: 17 });
    expect(x.service.beginPublish).not.toHaveBeenCalled();
    const y = setup();
    y.guild.roles.fetch.mockResolvedValue(null);
    await y.commands.onPublish([y.interaction] as any, { panelId: 17 });
    expect(y.service.beginPublish).not.toHaveBeenCalled();
  });

  it('leaves an uncertain publish inert without a duplicate Discord send', async () => {
    const x = setup();
    x.channel.send.mockRejectedValueOnce(new Error('network unavailable'));
    await x.commands.onPublish([x.interaction] as any, { panelId: 17 });
    expect(x.service.beginPublish).toHaveBeenCalledTimes(1);
    expect(x.service.activate).not.toHaveBeenCalled();
    expect(x.channel.send).toHaveBeenCalledTimes(1);
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('unconfirmed'),
    );
  });

  it('removes stale components when activation raced with disable', async () => {
    const x = setup();
    x.service.activate.mockResolvedValueOnce(false);
    await x.commands.onPublish([x.interaction] as any, { panelId: 17 });
    expect(x.message.edit).toHaveBeenCalledWith({ components: [] });
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('not activated'),
    );
  });

  it('disables in the database before best-effort message cleanup', async () => {
    const x = setup();
    await x.commands.onDisable([x.interaction] as any, { panelId: 17 });
    expect(x.service.disable).toHaveBeenCalledWith(guildId, 17);
    expect(x.channel.messages.fetch).toHaveBeenCalledWith(x.message.id);
    expect(x.message.edit).toHaveBeenCalledWith({ components: [] });
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('disabled'),
    );
  });

  it('allows disabling even after the panel channel is deleted', async () => {
    const x = setup();
    x.guild.channels.fetch.mockResolvedValue(null);
    await x.commands.onDisable([x.interaction] as any, { panelId: 17 });
    expect(x.service.disable).toHaveBeenCalledWith(guildId, 17);
    expect(x.interaction.editReply).toHaveBeenCalledWith(
      expect.stringContaining('disabled'),
    );
  });
});
