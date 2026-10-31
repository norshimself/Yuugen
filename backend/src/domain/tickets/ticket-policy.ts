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
