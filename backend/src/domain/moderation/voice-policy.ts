export const VOICE_SNOWFLAKE = /^\d{17,20}$/;

export type VoiceAction =
  | 'mute' | 'unmute'
  | 'deafen' | 'undeafen'
  | 'disconnect' | 'move';

export interface VoiceActionInput {
  action: VoiceAction;
  actorId: string;
  targetId: string;
  guildOwnerId: string;
  targetExists: boolean;
  targetIsBot: boolean;
  targetIsAdministrator: boolean;
  actorAboveTarget: boolean;
  botAboveTarget: boolean;
  sourceChannelId: string | null;
  connectedChannelId: string | null;
  sourceIsVoice: boolean;
  destinationChannelId: string | null;
  destinationIsVoice: boolean;
  actorCanModerateSource: boolean;
  botCanModerateSource: boolean;
  actorCanModerateDestination: boolean;
  botCanModerateDestination: boolean;
  actorCanConnectDestination: boolean;
  botCanConnectDestination: boolean;
  serverMute: boolean | null;
  serverDeaf: boolean | null;
}

/**
 * Pure, fail-closed checks. Re-evaluate from fresh Discord member, channel,
 * permissions and voice state data at preview and on confirmation.
 */
export function getVoiceActionDenial(input: VoiceActionInput): string | null {
  if (!input.targetExists) return 'The target is no longer in this server.';
  if (input.targetId === input.actorId) return 'You cannot moderate yourself.';
  if (input.targetId === input.guildOwnerId) {
    return 'The server owner cannot be voice-moderated.';
  }
  if (input.targetIsBot) return 'Voice moderation of bots is disabled.';
  if (input.targetIsAdministrator) {
    return 'Administrators are protected from this voice moderation command.';
  }
  if (input.actorId !== input.guildOwnerId && !input.actorAboveTarget) {
    return 'Your highest role must be above the target member.';
  }
  if (!input.botAboveTarget) {
    return 'Yuugen must have a higher role than the target member.';
  }
  if (!input.connectedChannelId || !input.sourceChannelId ||
      input.connectedChannelId !== input.sourceChannelId ||
      !input.sourceIsVoice) {
    return 'The target must still be in the expected voice channel.';
  }
  if (!input.actorCanModerateSource) {
    return 'You lack the required voice moderation permission in the source channel.';
  }
  if (!input.botCanModerateSource) {
    return 'Yuugen lacks the required voice moderation permission in the source channel.';
  }

  if (input.action === 'move') {
    if (!input.destinationChannelId || !input.destinationIsVoice ||
        input.destinationChannelId === input.sourceChannelId) {
      return 'Choose a different, valid destination voice channel.';
    }
    if (!input.actorCanModerateDestination ||
        !input.actorCanConnectDestination) {
      return 'You need Move Members and Connect in the destination channel.';
    }
    if (!input.botCanModerateDestination ||
        !input.botCanConnectDestination) {
      return 'Yuugen needs Move Members and Connect in the destination channel.';
    }
  }
  if (input.action === 'mute' || input.action === 'unmute') {
    if (typeof input.serverMute !== 'boolean') {
      return 'Cannot verify the current server mute state.';
    }
    if (input.action === 'mute' && input.serverMute) {
      return 'This member is already server-muted.';
    }
    if (input.action === 'unmute' && !input.serverMute) {
      return 'This member is not server-muted.';
    }
  }
  if (input.action === 'deafen' || input.action === 'undeafen') {
    if (typeof input.serverDeaf !== 'boolean') {
      return 'Cannot verify the current server deafen state.';
    }
    if (input.action === 'deafen' && input.serverDeaf) {
      return 'This member is already server-deafened.';
    }
    if (input.action === 'undeafen' && !input.serverDeaf) {
      return 'This member is not server-deafened.';
    }
  }
  return null;
}

export function cleanVoiceReason(reason: unknown): string | null {
  if (typeof reason !== 'string') return null;
  const result = reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return result.length >= 1 && result.length <= 512 ? result : null;
}

/** Only explicit permission denial or missing Discord resources count as conclusive. */
export function definitiveVoiceRejection(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const { status, code } = error as { status?: unknown; code?: unknown };
  return status === 403 || code === 50013 || code === 50001 ||
    code === 10007 || code === 10003;
}
