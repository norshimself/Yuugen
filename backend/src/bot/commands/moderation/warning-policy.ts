export interface WarningPolicyInput {
  actorUserId: string;
  targetUserId: string;
  guildOwnerId: string;
  actorHasModerateMembers: boolean;
  targetIsBot: boolean;
  targetIsGuildMember: boolean;
  actorRoleAboveTarget: boolean;
}

/**
 * Returns a safe rejection message or null if a staff member can warn the
 * target. Discord default slash-command permissions are not an auth boundary:
 * check these conditions for every interaction on the server.
 */
export function getWarningDenial(input: WarningPolicyInput): string | null {
  if (!input.actorHasModerateMembers) {
    return 'You need the Moderate Members permission.';
  }
  if (input.actorUserId === input.targetUserId) {
    return 'You cannot warn yourself.';
  }
  if (input.targetIsBot) {
    return 'Bots cannot receive moderation warnings.';
  }
  if (!input.targetIsGuildMember) {
    return 'The target must currently be a server member.';
  }
  if (input.targetUserId === input.guildOwnerId) {
    return 'The server owner cannot be warned.';
  }
  if (
    input.actorUserId !== input.guildOwnerId &&
    !input.actorRoleAboveTarget
  ) {
    return 'Your highest role must be above the target member.';
  }
  return null;
}
