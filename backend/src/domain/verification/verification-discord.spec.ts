import { ChannelType, PermissionFlagsBits } from 'discord.js';
import {
  canSafelyRemoveQuarantineRole, inspectVerificationEnvironment,
} from './verification-discord';

describe('Quarantine role/channel safety (#64)', () => {
  const guildId = '123456789012345678';
  const channelId = '234567890123456789';
  const roleId = '345678901234567890';

  function setup() {
    const everyone = { id: guildId };
    const bot = {
      id: '456789012345678901',
      permissions: { has: jest.fn().mockReturnValue(true) },
      roles: { highest: { comparePositionTo: jest.fn().mockReturnValue(1) } },
    };
    const role = {
      id: roleId, managed: false, manageable: true,
      permissions: { bitfield: 0n },
      guild: null as any,
    };
    const botCan = jest.fn().mockReturnValue(true);
    const roleCan = jest.fn().mockReturnValue(true);
    const everyoneCan = jest.fn().mockReturnValue(true);
    const allowed = { bitfield: 0n };
    const channel: any = {
      id: channelId, guildId, type: ChannelType.GuildText,
      permissionsFor: jest.fn((member: unknown) => ({
        has: member === bot ? botCan
          : member === everyone ? everyoneCan : roleCan,
      })),
      permissionOverwrites: { cache: new Map([[roleId, { allow: allowed }]]) },
    };
    const otherRoleCan = jest.fn().mockReturnValue(false);
    const otherEveryoneCan = jest.fn().mockReturnValue(false);
    const other: any = {
      id: '567890123456789012', guildId, type: ChannelType.GuildText,
      permissionsFor: jest.fn((member: unknown) => ({
        has: member === everyone ? otherEveryoneCan : otherRoleCan,
      })),
      permissionOverwrites: { cache: new Map() },
    };
    const channels = new Map([
      [channelId, channel], [other.id, other],
    ]);
    const guild: any = {
      id: guildId, roles: {
        everyone, fetch: jest.fn().mockResolvedValue(role),
      },
      channels: {
        fetch: jest.fn(async (id?: string) =>
          id ? channels.get(id) || null : channels),
      },
    };
    role.guild = guild;
    return {
      guild, bot, role, channel, other, channels, botCan,
      roleCan, everyoneCan, otherRoleCan, otherEveryoneCan, allowed,
    };
  }

  it('accepts a zero-permission role that sees only the verification channel', async () => {
    const x = setup();
    const { value, denial } = await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    );
    expect(denial).toBeNull();
    expect(value?.role).toBe(x.role);
    expect(value?.channel).toBe(x.channel);
  });

  it('rejects a quarantine role with ANY guild-wide permission bit', async () => {
    const x = setup();
    x.role.permissions.bitfield = PermissionFlagsBits.SendMessages;
    const result = await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    );
    expect(result.value).toBeNull();
    expect(result.denial).toContain('ordinary');
  });

  it('rejects the role if any other channel is accessible to @everyone pre-join', async () => {
    const x = setup();
    x.otherEveryoneCan.mockReturnValue(true);
    const result = await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    );
    expect(result.denial).toContain('beyond');
  });

  it('rejects access to any other channel even if everyone is denied', async () => {
    const x = setup();
    x.otherRoleCan.mockReturnValue(true);
    const result = await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    );
    expect(result.denial).toContain('beyond');
  });

  it('rejects untrusted allow overwrites in any other channel, including categories', async () => {
    const x = setup();
    x.other.permissionOverwrites.cache.set(roleId, {
      allow: { bitfield: PermissionFlagsBits.SendMessages },
    });
    const result = await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    );
    expect(result.denial).toContain('beyond');
  });

  it('allows only ViewChannel and ReadMessageHistory allow-overwrites in verification', async () => {
    const x = setup();
    x.allowed.bitfield = PermissionFlagsBits.ViewChannel |
      PermissionFlagsBits.ReadMessageHistory;
    expect((await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    )).denial).toBeNull();
    x.allowed.bitfield |= PermissionFlagsBits.ManageChannels;
    expect((await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    )).denial).toContain('beyond');
  });

  it('requires the bot to view and send messages in the verification channel', async () => {
    const x = setup();
    x.botCan.mockImplementation((permission: bigint) =>
      permission !== PermissionFlagsBits.SendMessages);
    const result = await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    );
    expect(result.denial).toContain('writable');
  });

  it('requires quarantine role and @everyone visibility in the verification channel', async () => {
    const x = setup();
    x.roleCan.mockReturnValue(false);
    expect((await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    )).denial).toContain('visible');
    x.roleCan.mockReturnValue(true);
    x.everyoneCan.mockReturnValue(false);
    expect((await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    )).denial).toContain('visible');
  });

  it('rejects managed roles, bot hierarchy loss and missing roles', async () => {
    const x = setup();
    x.role.managed = true;
    expect((await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    )).denial).toContain('ordinary');
    x.role.managed = false;
    x.bot.roles.highest.comparePositionTo.mockReturnValue(0);
    expect((await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    )).denial).toContain('ordinary');
    x.bot.roles.highest.comparePositionTo.mockReturnValue(1);
    x.guild.roles.fetch.mockResolvedValue(null);
    expect((await inspectVerificationEnvironment(
      x.guild, x.bot as any, channelId, roleId,
    )).denial).toContain('Could not verify');
  });

  it('removes only a current, bot-manageable role, never a deleted or higher role', async () => {
    const x = setup();
    expect(await canSafelyRemoveQuarantineRole(
      x.guild, x.bot as any, roleId,
    )).toBe(true);
    x.role.manageable = false;
    expect(await canSafelyRemoveQuarantineRole(
      x.guild, x.bot as any, roleId,
    )).toBe(false);
    x.role.manageable = true;
    x.bot.roles.highest.comparePositionTo.mockReturnValue(0);
    expect(await canSafelyRemoveQuarantineRole(
      x.guild, x.bot as any, roleId,
    )).toBe(false);
  });
});
