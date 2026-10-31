/** Pure, side-effect-free privacy/authorization invariants for ticket channels. */
export const TICKET_ID = /^\d{17,20}$/;
export const MAX_ACTIVE_TICKETS_PER_USER = 1;
export const TICKET_FEATURE_FLAG = 'ENABLE_TICKETS';

export function validId(value: unknown): value is string {
  return typeof value === 'string' && TICKET_ID.test(value);
}

export function requireTicketId(value: unknown, label: string): asserts value is string {
  if (!validId(value)) throw new Error('Invalid ' + label);
}

export function validTicketSetup(input: {
  guildId: string; categoryId: string; panelChannelId: string; staffRoleId: string;
}): boolean {
  return validId(input.guildId) && validId(input.categoryId) &&
    validId(input.panelChannelId) && validId(input.staffRoleId) &&
    input.staffRoleId !== input.guildId &&
    input.categoryId !== input.panelChannelId;
}

export function ticketStaffAllowed(
  roleIds: Iterable<string>, staffRoleId: string,
  hasManageGuild: boolean,
): boolean {
  return hasManageGuild || [...roleIds].includes(staffRoleId);
}

export function privateTicketOverwrites(
  guildId: string, openerId: string, staffRoleId: string, botId: string,
  bits: { ViewChannel: bigint; SendMessages: bigint;
    ReadMessageHistory: bigint; ManageChannels: bigint },
) {
  for (const [name, value] of [
    ['guild', guildId], ['opener', openerId], ['staff role', staffRoleId],
    ['bot', botId],
  ] as const) requireTicketId(value, name);
  if (staffRoleId === guildId || new Set([guildId, openerId, staffRoleId, botId]).size !== 4) {
    throw new Error('Conflicting ticket permission principals');
  }
  // Never copy category overwrites. The bot explicitly denies @everyone
  // and allows only the opener, configured staff role, and itself.
  return [
    { id: guildId, deny: [bits.ViewChannel] },
    { id: openerId, allow: [bits.ViewChannel, bits.SendMessages, bits.ReadMessageHistory] },
    { id: staffRoleId, allow: [bits.ViewChannel, bits.SendMessages, bits.ReadMessageHistory] },
    { id: botId, allow: [bits.ViewChannel, bits.SendMessages,
      bits.ReadMessageHistory, bits.ManageChannels] },
  ];
}

/**
 * Verify the provider's fresh channel overwrites, not merely the payload
 * supplied to channel.create(). An inherited/unexpected role/member allow can
 * expose private tickets even when @everyone is denied.
 *
 * Discord overwrite types: 0 = role, 1 = member. Guild administrators still
 * bypass channel overwrites; the selected staff role requires staff review.
 */
export function hasExactPrivateTicketOverwrites(
  overwrites: Iterable<{
    id: string; type: number;
    allow: { has(permission: bigint): boolean };
    deny: { has(permission: bigint): boolean };
  }>,
  guildId: string, openerId: string, staffRoleId: string, botId: string,
  viewChannel: bigint,
): boolean {
  const principals = [guildId, openerId, staffRoleId, botId];
  if (principals.some(id => !validId(id)) || new Set(principals).size !== 4 ||
      typeof viewChannel !== 'bigint' || viewChannel <= 0n) return false;

  const expected = new Map<string, { type: number; deny: boolean }>([
    [guildId, { type: 0, deny: true }],
    [openerId, { type: 1, deny: false }],
    [staffRoleId, { type: 0, deny: false }],
    [botId, { type: 1, deny: false }],
  ]);
  for (const row of overwrites) {
    if (!row || !row.allow || !row.deny ||
        typeof row.allow.has !== 'function' ||
        typeof row.deny.has !== 'function') return false;
    const principal = expected.get(row.id);
    if (!principal || row.type !== principal.type) return false;
    const allowed = row.allow.has(viewChannel);
    const denied = row.deny.has(viewChannel);
    if (principal.deny ? (!denied || allowed) : (!allowed || denied)) return false;
    expected.delete(row.id);
  }
  return expected.size === 0;
}

/** Only an explicit Discord authorization/validation rejection proves no channel was created. */
export function isDefinitiveChannelCreateRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code: unknown = (error as { code?: unknown }).code;
  return code === 50001 || code === 50013 || code === 50035;
}

export function ticketChannelName(id: string): string {
  if (!/^\d{1,19}$/.test(id) || BigInt(id) < 1n ||
      BigInt(id) > 9223372036854775807n) throw new Error('Invalid ticket sequence');
  return 'ticket-' + id;
}
