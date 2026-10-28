export interface UnbanPolicyInput {
  actorId: string;
  targetId: string;
  guildOwnerId: string;
  actorHasBanMembers: boolean;
  botHasBanMembers: boolean;
}

const SNOWFLAKE = /^\d{17,20}$/;

/**
 * An unban targets someone already absent from the guild, so member role
 * hierarchy is unavailable and not applicable. Both moderator and bot
 * must have Ban Members. Recheck the live ban list on confirmation.
 */
export function getUnbanDenial(input: UnbanPolicyInput): string | null {
  if (!input.actorHasBanMembers) {
    return 'You need the Ban Members permission.';
  }
  if (!input.botHasBanMembers) {
    return 'Yuugen needs the Ban Members permission.';
  }
  if (!SNOWFLAKE.test(input.targetId)) {
    return 'Provide a valid 17-20 digit Discord user ID.';
  }
  if (input.targetId === input.actorId) {
    return 'You cannot unban yourself.';
  }
  if (input.targetId === input.guildOwnerId) {
    return 'The server owner cannot be unbanned.';
  }
  return null;
}

/** Discord's documented "Unknown Ban" code (not an arbitrary HTTP 404). */
export function isUnknownBanError(error: unknown): boolean {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return false;
  }
  return error.code === 10026 || error.code === '10026';
}
