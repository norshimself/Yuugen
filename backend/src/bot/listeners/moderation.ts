export interface MessageActivity {
  timestamps: number[];
  lastContent: string;
  repeatCount: number;
  lastAt: number;
}

export interface ModerationRules {
  antiSpamEnabled: boolean;
  profanityFilterEnabled: boolean;
  blacklistedWords: string[];
}

function tokenize(content: string): string[] {
  return content
    .normalize('NFKC')
    .toLocaleLowerCase()
    .match(/[\p{L}\p{N}]+/gu) || [];
}

/** Match terms as full words or phrases, not as substrings inside other words. */
export function containsBlockedPhrase(
  message: string,
  forbiddenTerms: string[],
): boolean {
  const words = tokenize(message);
  return forbiddenTerms.some((term) => {
    const forbidden = tokenize(term);
    if (forbidden.length === 0 || forbidden.length > words.length) return false;

    for (let i = 0; i <= words.length - forbidden.length; i++) {
      if (forbidden.every((word, j) => words[i + j] === word)) return true;
    }
    return false;
  });
}

/**
 * Six messages within 8 seconds or three repeated identical messages within
 * 12 seconds is considered spam. State is per user *and* per guild.
 */
export function inspectMessage(
  content: string,
  rules: ModerationRules,
  now: number,
  previous?: MessageActivity,
): { reason: 'spam' | 'blacklist' | null; activity: MessageActivity } {
  const normalized = content.normalize('NFKC').trim().toLowerCase();
  const timestamps = (previous?.timestamps || [])
    .filter((time) => now - time <= 8000);
  timestamps.push(now);

  const repeated =
    normalized.length > 0 &&
    previous?.lastContent === normalized &&
    now - previous.lastAt <= 12000
      ? previous.repeatCount + 1
      : 1;

  const activity: MessageActivity = {
    timestamps,
    lastContent: normalized,
    repeatCount: repeated,
    lastAt: now,
  };

  if (
    rules.profanityFilterEnabled &&
    containsBlockedPhrase(content, rules.blacklistedWords || [])
  ) {
    return { reason: 'blacklist', activity };
  }

  if (
    rules.antiSpamEnabled &&
    (timestamps.length >= 6 || repeated >= 3)
  ) {
    return { reason: 'spam', activity };
  }

  return { reason: null, activity };
}
