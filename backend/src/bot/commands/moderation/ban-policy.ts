export interface BanPolicyInput {
  actorId: string;
  targetId: string;
  guildOwnerId: string;
  actorHasBanMembers: boolean;
  targetIsMember: boolean;
  targetIsBot: boolean;
  actorRoleAboveTarget: boolean;
  botHasBanMembers: boolean;
  targetBannable: boolean;
}

/**
 * Ban requires *both* the invoking moderator and Yuugen to have authority.
 * Re-evaluate with fresh guild member data when confirmation is pressed.
 */
export function getBanDenial(input: BanPolicyInput): string | null {
  if (!input.actorHasBanMembers) {
    return 'You need the Ban Members permission.';
  }
  if (input.actorId === input.targetId) {
    return 'You cannot ban yourself.';
  }
  if (input.targetIsBot) {
    return 'Bots cannot be banned through this command.';
  }
  if (!input.targetIsMember) {
    return 'The target must currently be a server member.';
  }
  if (input.targetId === input.guildOwnerId) {
    return 'The server owner cannot be banned.';
  }
  if (input.actorId !== input.guildOwnerId && !input.actorRoleAboveTarget) {
    return 'Your highest role must be above the target member.';
  }
  if (!input.botHasBanMembers) {
    return 'Yuugen needs the Ban Members permission.';
  }
  if (!input.targetBannable) {
    return 'Yuugen cannot ban this member: move its highest role above the target.';
  }
  return null;
}
