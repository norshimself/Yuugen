/** Lock only the @everyone SendMessages bit, leaving all other permissions intact. */
export const SEND_MESSAGES_BIT = 1n << 11n;
export const CHANNEL_SNOWFLAKE = /^\d{17,20}$/;

export type SendState = 'allow' | 'deny' | 'inherit';

export interface OverwriteSnapshot {
  existed: boolean;
  allow: string;
  deny: string;
}

export interface LockSnapshot {
  originalExisted: boolean;
  originalAllow: string;
  originalDeny: string;
  lockedAllow: string;
  lockedDeny: string;
}

export interface LockPermissionInput {
  actorCanView: boolean;
  actorCanManageChannels: boolean;
  actorCanManageRoles: boolean;
  botCanView: boolean;
  botCanManageChannels: boolean;
  botCanManageRoles: boolean;
}

export function getChannelLockDenial(input: LockPermissionInput): string | null {
  if (!input.actorCanView ||
      !input.actorCanManageChannels ||
      !input.actorCanManageRoles) {
    return 'You need View Channel, Manage Channels and Manage Roles in this channel.';
  }
  if (!input.botCanView ||
      !input.botCanManageChannels ||
      !input.botCanManageRoles) {
    return 'Yuugen needs View Channel, Manage Channels and Manage Roles in this channel.';
  }
  return null;
}

export function readSendState(snapshot: OverwriteSnapshot): SendState {
  const allow = BigInt(snapshot.allow);
  const deny = BigInt(snapshot.deny);
  if ((deny & SEND_MESSAGES_BIT) !== 0n) return 'deny';
  if ((allow & SEND_MESSAGES_BIT) !== 0n) return 'allow';
  return 'inherit';
}

export function makeLockSnapshot(original: OverwriteSnapshot): LockSnapshot {
  const allow = BigInt(original.allow);
  const deny = BigInt(original.deny);
  if (allow < 0n || deny < 0n ||
      ((allow & deny) !== 0n)) {
    throw new Error('Invalid existing channel permissions');
  }
  if (readSendState(original) === 'deny') {
    throw new Error('The @everyone role is already denied Send Messages.');
  }
  return {
    originalExisted: original.existed,
    originalAllow: allow.toString(),
    originalDeny: deny.toString(),
    lockedAllow: (allow & ~SEND_MESSAGES_BIT).toString(),
    lockedDeny: (deny | SEND_MESSAGES_BIT).toString(),
  };
}

/** Fail closed if ANY overwrite bit has changed since the lock was created. */
export function matchesLockedSnapshot(
  lock: LockSnapshot,
  current: OverwriteSnapshot,
): boolean {
  return current.existed &&
    BigInt(current.allow) === BigInt(lock.lockedAllow) &&
    BigInt(current.deny) === BigInt(lock.lockedDeny);
}

/** Compute the exact original state of just SendMessages for restoration. */
export function originalSendOverride(lock: LockSnapshot): boolean | null {
  return readSendState({
    existed: lock.originalExisted,
    allow: lock.originalAllow,
    deny: lock.originalDeny,
  }) === 'allow' ? true : null;
}

export function getChannelLockReason(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const reason = input.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return reason.length >= 1 && reason.length <= 512 ? reason : null;
}
