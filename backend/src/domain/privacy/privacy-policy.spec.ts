import {
  RETENTION, RETAINED_ON_SELF_ERASURE, PRIVACY_ERASURE_CONFIRMATION,
  PRIVACY_ERASURE_SCOPE, assertDiscordId, assertOwnErasureRequest,
  economyExport, triviaExport, sessionMetadata,
  guildSettingsExport, autoModRuleExport,
} from './privacy-policy';

describe('Privacy policy: bounded retention, explicit consent and safe projections',()=>{
  it('validates Discord IDs with no numeric precision loss',()=>{
    expect(()=>assertDiscordId('123456789012345678','user')).not.toThrow();
    expect(()=>assertDiscordId('123','user')).toThrow('user');
    expect(()=>assertDiscordId(123456789012345678n,'user')).toThrow('user');
    expect(()=>assertDiscordId('1; DROP TABLE','guild')).toThrow('guild');
  });

  it('requires the exact erasure phrase, scope and no extra fields',()=>{
    const good={confirmation:PRIVACY_ERASURE_CONFIRMATION,scope:PRIVACY_ERASURE_SCOPE};
    expect(()=>assertOwnErasureRequest(good)).not.toThrow();
    for(const bad of [
      null,[],{},'yes',
      {...good,confirmation:'yes'},
      {...good,scope:'moderation_audit'},
      {...good,targetUserId:'987654321012345678'},
      {confirmation:good.confirmation},
    ]) expect(()=>assertOwnErasureRequest(bad)).toThrow();
  });

  it('locks expiration policy to existing auth expiry and trivia lifetime',()=>{
    expect(RETENTION.authExpirySource).toBe('expiresAt');
    expect(RETENTION.triviaLifetimeMinutes).toBe(15);
    expect(RETENTION.batchSize).toBe(250);
    expect(RETENTION.sweepIntervalMinutes).toBe(30);
    expect(Object.isFrozen(RETENTION)).toBe(true);
    expect(RETAINED_ON_SELF_ERASURE).toContain('moderation_and_purge_audit');
  });

  it('returns explicit economy fields, not future private properties',()=>{
    const profile={
      xp:99,level:3,coins:50,bank:10,inventory:['badge'],
      lastDaily:new Date('2026-10-01T00:00:00Z'),
      lastWork:null,lastCrime:null,lastRob:null,lastRps:null,lastTrivia:null,
      oauthRefreshToken:'secret',
    };
    const output=economyExport(profile);
    expect(output?.lastDaily).toBe('2026-10-01T00:00:00.000Z');
    expect(output).not.toHaveProperty('oauthRefreshToken');
    expect(output?.inventory).toEqual(['badge']);
    expect(output?.inventory).not.toBe(profile.inventory);
    expect(economyExport(null)).toBe(null);
  });

  it('exports trivia metadata without arbitrary user-controlled fields',()=>{
    const persisted = {
      questionId:4,messageId:'234567890123456789',correctIndex:2,
      reward:50,createdAt:new Date('2026-10-01T00:00:00Z'),
      secret:'not-exported',
    };
    expect(triviaExport(persisted)).toEqual({
      questionId:4,messageId:'234567890123456789',correctIndex:2,
      reward:50,createdAt:'2026-10-01T00:00:00.000Z',
    });
    expect(triviaExport(null)).toBe(null);
  });

  it('never exports refresh cookie IDs or hashed one-time OAuth codes',()=>{
    const savedSession={
      id:'oauth-code:secret-token-digest',
      userId:'123456789012345678',
      createdAt:new Date('2026-10-01T00:00:00Z'),
      expiresAt:new Date('2026-10-08T00:00:00Z'),
    };
    const meta=sessionMetadata(savedSession);
    expect(Object.keys(meta)).toEqual(['createdAt','expiresAt']);
    expect(JSON.stringify(meta)).not.toMatch(/oauth-code|secret-token|userId|id/);
  });

  it('restricts guild export to known fields and clones rule arrays',()=>{
    const savedSettings={
      prefix:'?', welcomeChannelId:null,welcomeMessage:'Welcome',
      antiSpamEnabled:false,profanityFilterEnabled:false,blacklistedWords:['bad'],
      secret:'no',
    };
    const settings=guildSettingsExport(savedSettings);
    expect(settings).not.toHaveProperty('secret');
    expect(settings?.blacklistedWords).toEqual(['bad']);
    const rule={
      id:7,name:'blocked',enabled:true,kind:'blocked_phrases',action:'dry_run',
      priority:1,phrases:['word'],threshold:6,windowSeconds:8,
      exemptChannelIds:['234567890123456789'],exemptRoleIds:[],
      internalAccessToken:'never',
    };
    const output=autoModRuleExport(rule);
    expect(output).not.toHaveProperty('internalAccessToken');
    expect(output.phrases).not.toBe(rule.phrases);
  });
});
