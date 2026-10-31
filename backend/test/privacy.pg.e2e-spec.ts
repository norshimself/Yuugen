/**
 * Opt-in real PostgreSQL acceptance for issue #91.
 * Creates/drops a uniquely named database on the LOCAL Postgres server.
 * Existing databases, staging and production MUST NOT be used.
 *
 * Run with a disposable local Postgres 17 instance and CREATEDB:
 * YUUGEN_PRIVACY_TEST_ADMIN_URL=postgres://...@127.0.0.1:5432/postgres \
 * YUUGEN_PRIVACY_TEST_CONFIRM=disposable \
 *   npm run test:e2e -- --runInBand privacy.pg.e2e-spec.ts
 *
 * This suite is skipped by default and has NOT been executed.
 */
import { randomBytes } from 'node:crypto';
import { DataSource } from 'typeorm';
import { Session } from '../src/api/auth/session.entity';
import { UserProfile } from '../src/domain/economy/user-profile.entity';
import { TriviaSession } from '../src/domain/economy/trivia-session.entity';
import { GuildSettings } from '../src/domain/settings/guild-settings.entity';
import { AutoModRule } from '../src/domain/moderation/automod-rule.entity';
import { ModerationCase } from '../src/domain/moderation/moderation-case.entity';
import { PrivacyService } from '../src/domain/privacy/privacy.service';

const ADMIN_URL = process.env.YUUGEN_PRIVACY_TEST_ADMIN_URL;
const enabled = Boolean(
  ADMIN_URL && process.env.YUUGEN_PRIVACY_TEST_CONFIRM === 'disposable',
);
const describeDatabase = enabled ? describe : describe.skip;
const userA='123456789012345678';
const userB='234567890123456789';
const guildA='345678901234567890';
const guildB='456789012345678901';
const entities=[
  Session, UserProfile, TriviaSession, GuildSettings, AutoModRule, ModerationCase,
];

describeDatabase('Privacy exports, erasure and TTL on disposable PostgreSQL 17',()=>{
  let admin: DataSource;
  let dbA: DataSource;
  let dbB: DataSource;
  let privacyA: PrivacyService;
  let privacyB: PrivacyService;
  const dbName='yuugen_privacy_it_'+randomBytes(8).toString('hex');
  let created=false;

  function service(db: DataSource) {
    return new PrivacyService(
      db.getRepository(Session),db.getRepository(UserProfile),
      db.getRepository(TriviaSession),db.getRepository(GuildSettings),
      db.getRepository(AutoModRule),db,
    );
  }

  beforeAll(async()=>{
    if (!ADMIN_URL || process.env.NODE_ENV==='production') {
      throw new Error('Privacy acceptance must never target production');
    }
    const parsed=new URL(ADMIN_URL);
    if (!['postgres:','postgresql:'].includes(parsed.protocol) ||
        !['localhost','127.0.0.1','[::1]'].includes(parsed.hostname)) {
      throw new Error('Only an explicit loopback PostgreSQL server is allowed');
    }
    const target=new URL(ADMIN_URL);
    target.pathname='/'+dbName;
    target.search='';
    admin=new DataSource({type:'postgres',url:ADMIN_URL,
      synchronize:false,entities:[]});
    await admin.initialize();
    await admin.query('CREATE DATABASE "'+dbName+'"');
    created=true;
    // Synchronization is acceptable ONLY in the newly-created disposable DB.
    // Production continues to use reviewed migrations.
    dbA=new DataSource({type:'postgres',url:target.href,
      synchronize:true,entities});
    await dbA.initialize();
    dbB=new DataSource({type:'postgres',url:target.href,
      synchronize:false,entities});
    await dbB.initialize();
    privacyA=service(dbA);
    privacyB=service(dbB);
  },45000);

  afterAll(async()=>{
    if(dbA?.isInitialized)await dbA.destroy();
    if(dbB?.isInitialized)await dbB.destroy();
    if(admin?.isInitialized){
      try{
        if(created)await admin.query('DROP DATABASE "'+dbName+'" WITH (FORCE)');
      }finally{
        await admin.destroy();
      }
    }
  },30000);

  beforeEach(async()=>{
    await dbA.query(
      'TRUNCATE TABLE public.moderation_cases, public.automod_rules, '+
      'public.guild_settings, public.trivia_sessions, public.user_profiles, '+
      'public.sessions RESTART IDENTITY CASCADE',
    );
  });

  async function seedPersonal(){
    await dbA.getRepository(UserProfile).save([
      {userId:userA,coins:123,xp:6,level:1,bank:0,inventory:['badge']},
      {userId:userB,coins:987,xp:9,level:2,bank:9,inventory:['vip']},
    ]);
    await dbA.getRepository(TriviaSession).save([
      {userId:userA,correctIndex:0,reward:50,questionId:1,messageId:null},
      {userId:userB,correctIndex:1,reward:20,questionId:2,messageId:null},
    ]);
    const expire=new Date(Date.now()+60*60*1000);
    await dbA.getRepository(Session).save([
      {id:'11111111-1111-4111-8111-111111111111',
        userId:userA,expiresAt:expire},
      {id:'22222222-2222-4222-8222-222222222222',
        userId:userB,expiresAt:expire},
    ]);
  }

  it('exports only own rows and erases only user A while retaining moderation audit',async()=>{
    await seedPersonal();
    await dbA.getRepository(ModerationCase).save({
      guildId:guildA,targetUserId:userA,moderatorUserId:userB,
      action:'warn',reason:'Original audit evidence',
      expiresAt:null,revokedAt:null,revokedByUserId:null,revocationReason:null,
    });
    const exported=await privacyA.exportSelf(userA);
    expect(exported.userId).toBe(userA);
    expect(exported.economy?.coins).toBe(123);
    expect(JSON.stringify(exported)).not.toContain(
      '11111111-1111-4111-8111-111111111111',
    );
    expect(JSON.stringify(exported)).not.toContain(userB);
    const first=await privacyA.eraseSelf(userA);
    expect(first.removed).toEqual({
      economyProfiles:1,triviaSessions:1,authSessions:1,
    });
    expect((await privacyB.eraseSelf(userA)).removed).toEqual({
      economyProfiles:0,triviaSessions:0,authSessions:0,
    });
    expect(await dbA.getRepository(UserProfile).findOneBy({userId:userA}))
      .toBeNull();
    expect((await dbA.getRepository(UserProfile).findOneBy({userId:userB}))?.coins)
      .toBe(987);
    expect(await dbA.getRepository(Session).count({where:{userId:userB}}))
      .toBe(1);
    const audit=await dbB.getRepository(ModerationCase).findOneBy({
      guildId:guildA,targetUserId:userA,
    });
    expect(audit?.reason).toBe('Original audit evidence');
  });

  it('guild configuration export has a strict guild ID predicate',async()=>{
    await dbA.getRepository(GuildSettings).save([
      {guildId:guildA,prefix:'!'},
      {guildId:guildB,prefix:'?'},
    ]);
    await dbA.getRepository(AutoModRule).save([
      {guildId:guildA,name:'A rule',kind:'blocked_phrases',
        phrases:['A'],action:'dry_run',enabled:true},
      {guildId:guildB,name:'B rule',kind:'blocked_phrases',
        phrases:['B'],action:'dry_run',enabled:true},
    ]);
    const result=await privacyB.exportGuild(guildA);
    expect(result.settings?.prefix).toBe('!');
    expect(result.automodRules).toHaveLength(1);
    expect(result.automodRules[0].name).toBe('A rule');
    expect(JSON.stringify(result)).not.toContain('B rule');
    expect(JSON.stringify(result)).not.toContain(guildB);
  });

  it('two workers only remove expired rows using SKIP LOCKED, never active rows',async()=>{
    const expired=new Date(Date.now()-60_000);
    const future=new Date(Date.now()+60*60_000);
    const ago=new Date(Date.now()-20*60_000);
    await dbA.getRepository(Session).save([
      {id:'33333333-3333-4333-8333-333333333333',userId:userA,expiresAt:expired},
      {id:'44444444-4444-4444-8444-444444444444',userId:userB,expiresAt:future},
    ]);
    await dbA.getRepository(TriviaSession).save([
      {userId:userA,correctIndex:1,reward:30,questionId:null,
        messageId:null,createdAt:ago},
      {userId:userB,correctIndex:0,reward:10,questionId:null,
        messageId:null,createdAt:new Date()},
    ]);
    const [first,second]=await Promise.all([
      privacyA.pruneExpiredEphemeral(), privacyB.pruneExpiredEphemeral(),
    ]);
    expect(first.sessions+second.sessions).toBe(1);
    expect(first.triviaSessions+second.triviaSessions).toBe(1);
    expect(await dbA.getRepository(Session).count()).toBe(1);
    expect(await dbA.getRepository(TriviaSession).count()).toBe(1);
    expect(await dbA.getRepository(Session).findOneBy({userId:userB}))
      .not.toBeNull();
    expect(await dbA.getRepository(TriviaSession).findOneBy({userId:userB}))
      .not.toBeNull();
  });
});
