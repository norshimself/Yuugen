/**
 * Privacy safety rules for the currently deployed schema (issue #91).
 *
 * Do not broaden erasure to moderation or guild audit records without a
 * separately reviewed retention policy, legal-hold check, and migration.
 */
export const PRIVACY_ERASURE_CONFIRMATION = 'ERASE_MY_YUUGEN_DATA';
export const PRIVACY_ERASURE_SCOPE = 'global_economy_and_ephemeral_auth';

export const RETENTION = Object.freeze({
  /** Auth sessions last at most 7 days; OAuth code grants expire in 2 minutes. */
  authExpirySource: 'expiresAt',
  /** Trivia can no longer be answered after 15 minutes. */
  triviaLifetimeMinutes: 15,
  /** Bounded deletion per table per pass. */
  batchSize: 250,
  /** Schedule is opt-in until staged and verified. */
  sweepIntervalMinutes: 30,
});

export const RETAINED_ON_SELF_ERASURE = Object.freeze([
  'guild_settings_and_automod_rules',
  'moderation_and_purge_audit',
  'moderation_channel_lock_and_voice_audit',
  'discord_or_third_party_data',
  'backups_until_their_separate_retention_expiry',
] as const);

const DISCORD_ID = /^\d{17,20}$/;

export function assertDiscordId(value: unknown, label: string): asserts value is string {
  if (typeof value !== 'string' || !DISCORD_ID.test(value)) {
    throw new Error('Invalid ' + label);
  }
}

export function assertOwnErasureRequest(value: unknown): void {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('A confirmation and erasure scope are required');
  }
  const fields = value as Record<string, unknown>;
  if (Object.keys(fields).sort().join(',') !== 'confirmation,scope' ||
      fields.confirmation !== PRIVACY_ERASURE_CONFIRMATION ||
      fields.scope !== PRIVACY_ERASURE_SCOPE) {
    throw new Error('Invalid erasure confirmation or scope');
  }
}

export type EconomyExport = {
  xp: number; level: number; coins: number; bank: number;
  inventory: string[];
  lastDaily: string | null; lastWork: string | null;
  lastCrime: string | null; lastRob: string | null;
  lastRps: string | null; lastTrivia: string | null;
};

function utc(value: Date | string | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const time = value instanceof Date ? value : new Date(value);
  if (!Number.isFinite(time.getTime())) throw new Error('Invalid persisted timestamp');
  return time.toISOString();
}

/** Fixed allowlist: never serialize future private columns automatically. */
export function economyExport(profile: {
  xp:number; level:number; coins:number; bank:number; inventory:string[];
  lastDaily?:Date|null; lastWork?:Date|null; lastCrime?:Date|null;
  lastRob?:Date|null; lastRps?:Date|null; lastTrivia?:Date|null;
} | null): EconomyExport | null {
  if (!profile) return null;
  return {
    xp:profile.xp, level:profile.level, coins:profile.coins, bank:profile.bank,
    inventory:Array.isArray(profile.inventory)?[...profile.inventory]:[],
    lastDaily:utc(profile.lastDaily), lastWork:utc(profile.lastWork),
    lastCrime:utc(profile.lastCrime), lastRob:utc(profile.lastRob),
    lastRps:utc(profile.lastRps), lastTrivia:utc(profile.lastTrivia),
  };
}

export function triviaExport(value: {
  questionId:number|null; messageId:string|null; correctIndex:number;
  reward:number; createdAt:Date;
}|null) {
  if (!value) return null;
  return {
    questionId:value.questionId,
    messageId:value.messageId,
    correctIndex:value.correctIndex,
    reward:value.reward,
    createdAt:utc(value.createdAt),
  };
}

export function sessionMetadata(value: {
  createdAt:Date; expiresAt:Date;
}) {
  // NEVER expose id: it is the live refresh cookie / OAuth-code digest.
  return {createdAt:utc(value.createdAt),expiresAt:utc(value.expiresAt)};
}

export function guildSettingsExport(value: {
  prefix:string;welcomeChannelId:string|null;welcomeMessage:string;
  antiSpamEnabled:boolean;profanityFilterEnabled:boolean;blacklistedWords:string[];
}|null) {
  if(!value) return null;
  return {
    prefix:value.prefix, welcomeChannelId:value.welcomeChannelId,
    welcomeMessage:value.welcomeMessage,
    antiSpamEnabled:value.antiSpamEnabled,
    profanityFilterEnabled:value.profanityFilterEnabled,
    blacklistedWords:Array.isArray(value.blacklistedWords)
      ? [...value.blacklistedWords] : [],
  };
}

export function autoModRuleExport(value: {
  id:number;name:string;enabled:boolean;kind:string;action:string;priority:number;
  phrases:string[];threshold:number;windowSeconds:number;
  exemptChannelIds:string[];exemptRoleIds:string[];
}) {
  return {
    id:value.id,name:value.name,enabled:value.enabled,kind:value.kind,
    action:value.action,priority:value.priority,
    phrases:[...value.phrases],threshold:value.threshold,
    windowSeconds:value.windowSeconds,
    exemptChannelIds:[...value.exemptChannelIds],
    exemptRoleIds:[...value.exemptRoleIds],
  };
}
