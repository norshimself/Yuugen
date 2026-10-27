export interface KickPolicyInput {
  actorId: string;
  targetId: string;
  guildOwnerId: string;
  actorHasKickMembers: boolean;
  targetIsMember: boolean;
  targetIsBot: boolean;
  actorRoleAboveTarget: boolean;
  botHasKickMembers: boolean;
  targetKickable: boolean;
}

/**
 * Both the human moderator and the bot must have authority to kick.
 * Re-evaluate this policy immediately before calling Discord's kick API;
 * permissions and role positions may change during confirmation.
 */
export function getKickDenial(input: KickPolicyInput): string | null {
  if (!input.actorHasKickMembers) {
    return 'You need the Kick Members permission.';
  }
  if (input.actorId === input.targetId) {
    return 'You cannot kick yourself.';
  }
  if (input.targetIsBot) {
    return 'Bots cannot be kicked through this command.';
  }
  if (!input.targetIsMember) {
    return 'The target must currently be a server member.';
  }
  if (input.targetId === input.guildOwnerId) {
    return 'The server owner cannot be kicked.';
  }
  if (
    input.actorId !== input.guildOwnerId &&
    !input.actorRoleAboveTarget
  ) {
    return 'Your highest role must be above the target member.';
  }
  if (!input.botHasKickMembers) {
    return 'Yuugen needs the Kick Members permission.';
  }
  if (!input.targetKickable) {
    return 'Yuugen cannot kick this member: move its highest role above the target.';
  }
  return null;
}
