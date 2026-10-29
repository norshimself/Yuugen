import {
  ChannelType, Guild, GuildMember, PermissionFlagsBits,
  Role, TextChannel,
} from 'discord.js';
import { roleConfigurationDenial } from '../roles/role-panel-policy';
import { verificationChannelDenial, validDiscordId } from './verification-policy';

export interface VerificationEnvironment {
  role: Role;
  channel: TextChannel;
}
/**
 * Safe quarantine requires a role granting ZERO guild-wide privileges and
 * a private-by-default server: @everyone cannot view other channels even
 * in the short interval before Guild Members delivery and role assignment.
 *
 * This only validates the visible ordinary guild channels Discord returns;
 * active threads, integrations, and future overwrites remain operator risks.
 */
export async function inspectVerificationEnvironment(
  guild: Guild, bot: GuildMember, channelId: string, roleId: string,
): Promise<{ value: VerificationEnvironment | null; denial: string | null }> {
  if (!validDiscordId(channelId) || !validDiscordId(roleId)) {
    return { value: null, denial: 'Choose actual guild channel and role IDs.' };
  }
  const [role, channel, allChannels] = await Promise.all([
    guild.roles.fetch(roleId, { force: true }).catch(() => null),
    guild.channels.fetch(channelId, { force: true }).catch(() => null),
    guild.channels.fetch().catch(() => null),
  ]);
  if (!role || !channel || channel.type !== ChannelType.GuildText ||
      !allChannels || role.guild.id !== guild.id || channel.guildId !== guild.id) {
    return { value: null, denial: 'Could not verify role, text channel and complete guild channel list.' };
  }
  const denial = roleConfigurationDenial({
    guildId: guild.id, roleGuildId: role.guild.id,
    roleId: role.id, isEveryone: role.id === guild.id,
    managed: role.managed,
    botHasManageRoles: bot.permissions.has(PermissionFlagsBits.ManageRoles),
    botIsAboveRole: bot.roles.highest.comparePositionTo(role) > 0,
    permissionBits: role.permissions.bitfield,
  });
  const view = PermissionFlagsBits.ViewChannel;
  const read = PermissionFlagsBits.ReadMessageHistory;
  const botPermissions = channel.permissionsFor(bot);
  const rolePermissions = channel.permissionsFor(role);
  const everyonePermissions = channel.permissionsFor(guild.roles.everyone);
  let unsafeOverwrites = false;
  let otherVisibleChannels = false;
  const targetOverwrite = channel.permissionOverwrites.cache.get(roleId);
  // The quarantine role may only be explicitly allowed View Channel and
  // Read Message History in the verification channel.
  if (targetOverwrite && (targetOverwrite.allow.bitfield & ~(view | read)) !== 0n) {
    unsafeOverwrites = true;
  }
  for (const other of allChannels.values()) {
    if (!other || other.id === channelId) continue;
    if ('permissionOverwrites' in other) {
      const overwrite = other.permissionOverwrites.cache.get(roleId);
      if (overwrite && overwrite.allow.bitfield !== 0n) unsafeOverwrites = true;
    }
    if (other.type === ChannelType.GuildCategory) continue;
    if (!('permissionsFor' in other)) {
      otherVisibleChannels = true; // Unknown channel type must fail closed.
      continue;
    }
    const roleCanView = other.permissionsFor(role)?.has(view);
    const everyoneCanView = other.permissionsFor(guild.roles.everyone)?.has(view);
    if (roleCanView !== false || everyoneCanView !== false) {
      otherVisibleChannels = true;
    }
  }
  const why = verificationChannelDenial({
    roleSafe: !denial && role.permissions.bitfield === 0n && role.manageable,
    botCanManageRoles: bot.permissions.has(PermissionFlagsBits.ManageRoles),
    botAboveRole: bot.roles.highest.comparePositionTo(role) > 0,
    botCanSeeAndPost: !!botPermissions?.has(view) &&
      !!botPermissions.has(PermissionFlagsBits.SendMessages),
    quarantineCanViewVerification: !!rolePermissions?.has(view) &&
      !!everyonePermissions?.has(view),
    unsafeOverwrites, otherVisibleChannels,
  });
  return why
    ? { value: null, denial: why }
    : { value: { role, channel }, denial: null };
}

/** Re-check the ONE role to be removed; never grant anything on release. */
export async function canSafelyRemoveQuarantineRole(
  guild: Guild, bot: GuildMember, roleId: string,
): Promise<boolean> {
  if (!validDiscordId(roleId) ||
      !bot.permissions.has(PermissionFlagsBits.ManageRoles)) return false;
  const role = await guild.roles.fetch(roleId, { force: true }).catch(() => null);
  return !!role && role.guild.id === guild.id &&
    role.id !== guild.id && !role.managed &&
    bot.roles.highest.comparePositionTo(role) > 0 && role.manageable;
}
