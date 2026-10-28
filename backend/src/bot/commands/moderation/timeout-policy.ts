export type TimeoutAction = 'timeout' | 'untimeout';

export const MIN_TIMEOUT_MS = 60_000;
export const MAX_TIMEOUT_MS = 28 * 24 * 60 * 60 * 1000;

/** Accepted inputs: 1m-40320m, 1h-672h, or 1d-28d. */
export function parseTimeoutDuration(input: unknown): number | null {
  if (typeof input !== 'string') return null;
  const match = /^(\d{1,5})([mhd])$/i.exec(input.trim());
  if (!match) return null;
  const count = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multiplier = unit === 'm'
    ? 60_000
    : unit === 'h'
      ? 3_600_000
      : 86_400_000;
  const millis = count * multiplier;
  if (!Number.isSafeInteger(millis) ||
      millis < MIN_TIMEOUT_MS ||
      millis > MAX_TIMEOUT_MS) {
    return null;
  }
  return millis;
}

export function formatTimeoutDuration(millis: number): string {
  const day = 86_400_000;
  const hour = 3_600_000;
  if (millis % day === 0) {
    const count = millis / day;
    return count + (count === 1 ? ' day' : ' days');
  }
  if (millis % hour === 0) {
    const count = millis / hour;
    return count + (count === 1 ? ' hour' : ' hours');
  }
  const count = millis / 60_000;
  return count + (count === 1 ? ' minute' : ' minutes');
}

export interface TimeoutPolicyInput {
  action: TimeoutAction;
  actorId: string;
  targetId: string;
  guildOwnerId: string;
  actorHasModerateMembers: boolean;
  botHasModerateMembers: boolean;
  targetIsMember: boolean;
  targetIsBot: boolean;
  actorRoleAboveTarget: boolean;
  targetModeratable: boolean;
  currentlyTimedOut: boolean;
}

/**
 * Applied against fresh Discord guild membership/permissions both at preview
 * and confirmation. A server owner may bypass actor role ordering, but not
 * the bot's hierarchy or Discord's restrictions on administrator timeouts.
 */
export function getTimeoutDenial(input: TimeoutPolicyInput): string | null {
  if (!input.actorHasModerateMembers) {
    return 'You need the Moderate Members permission.';
  }
  if (input.actorId === input.targetId) {
    return 'You cannot moderate yourself.';
  }
  if (!input.targetIsMember) {
    return 'The target must currently be a server member.';
  }
  if (input.targetIsBot) {
    return 'Bots cannot receive communication timeouts.';
  }
  if (input.targetId === input.guildOwnerId) {
    return 'The server owner cannot be timed out.';
  }
  if (
    input.actorId !== input.guildOwnerId &&
    !input.actorRoleAboveTarget
  ) {
    return 'Your highest role must be above the target member.';
  }
  if (!input.botHasModerateMembers) {
    return 'Yuugen needs the Moderate Members permission.';
  }
  if (!input.targetModeratable) {
    return 'Yuugen cannot moderate this member: check its role hierarchy and the target permissions.';
  }
  if (input.action === 'timeout' && input.currentlyTimedOut) {
    return 'This member is already timed out. Remove the timeout before setting a new one.';
  }
  if (input.action === 'untimeout' && !input.currentlyTimedOut) {
    return 'This member is not currently timed out.';
  }
  return null;
}

/** Only an explicit permission denial or unknown-member code proves failure. */
export function isDefinitiveTimeoutRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const response = error as { status?: unknown; code?: unknown };
  return response.status === 403 ||
    response.code === 10007 ||
    response.code === '10007';
}
