import { DataSource } from 'typeorm';
import { PrivacyService } from './privacy.service';
import { Session } from '../../api/auth/session.entity';
import { UserProfile } from '../economy/user-profile.entity';
import { TriviaSession } from '../economy/trivia-session.entity';

const me='123456789012345678';
const another='234567890123456789';
const guild='345678901234567890';

function setup() {
  const sessions={
    count:jest.fn().mockResolvedValue(1),
    find:jest.fn().mockResolvedValue([{
      id:'real-refresh-cookie-secret',userId:me,
      createdAt:new Date('2026-10-01T00:00:00Z'),
      expiresAt:new Date('2026-10-08T00:00:00Z'),
    }]),
    delete:jest.fn().mockResolvedValue({affected:1}),
  };
  const profiles={
    findOne:jest.fn().mockResolvedValue({
      userId:me,xp:40,level:1,coins:100,bank:0,inventory:['badge'],
      lastDaily:null,lastWork:null,lastCrime:null,lastRob:null,
      lastRps:null,lastTrivia:null,
    }),
    delete:jest.fn().mockResolvedValue({affected:1}),
  };
  const trivia={
    findOne:jest.fn().mockResolvedValue({
      userId:me,questionId:7,messageId:null,correctIndex:2,reward:50,
      createdAt:new Date('2026-10-01T00:00:00Z'),
    }),
    delete:jest.fn().mockResolvedValue({affected:1}),
  };
  const settings={findOne:jest.fn().mockResolvedValue(null)};
  const automod={find:jest.fn().mockResolvedValue([])};
  const repositories=new Map<unknown,any>([
    [Session,sessions],[UserProfile,profiles],[TriviaSession,trivia],
  ]);
  const transaction=jest.fn(async(fn:any)=>fn({
    getRepository:(entity:unknown)=>{
      const repository=repositories.get(entity);
      if(!repository)throw new Error('Unexpected deletion target');
      return repository;
    },
  }));
  const query=jest.fn()
    .mockResolvedValueOnce([{count:2}])
    .mockResolvedValueOnce([{count:3}]);
  const db={transaction,query};
  const privacy=new PrivacyService(
    sessions as any,profiles as any,trivia as any,
    settings as any,automod as any,db as unknown as DataSource,
  );
  return {privacy,sessions,profiles,trivia,settings,automod,transaction,query};
}

describe('PrivacyService self/guild scoping and TTL cleanup',()=>{
  it('exports ONLY the caller-owned data without persisting or exposing session tokens',async()=>{
    const t=setup();
    const result=await t.privacy.exportSelf(me);
    expect(result.scope).toBe('authenticated_user');
    expect(result.userId).toBe(me);
    expect(result.economy?.coins).toBe(100);
    expect(result.trivia?.questionId).toBe(7);
    expect(result.authentication.count).toBe(1);
    expect(result.authentication.sessions[0]).toHaveProperty('expiresAt');
    expect(JSON.stringify(result)).not.toContain('real-refresh-cookie-secret');
    expect(t.profiles.findOne).toHaveBeenCalledWith({where:{userId:me}});
    expect(t.trivia.findOne).toHaveBeenCalledWith({where:{userId:me}});
    expect(t.sessions.count).toHaveBeenCalledWith({where:{userId:me}});
    expect(t.sessions.find).toHaveBeenCalledWith(expect.objectContaining({
      where:{userId:me},take:50,
    }));
    expect(t.transaction).not.toHaveBeenCalled();
  });

  it('never creates a profile as a side effect of export and marks session truncation',async()=>{
    const t=setup();
    t.profiles.findOne.mockResolvedValueOnce(null);
    t.trivia.findOne.mockResolvedValueOnce(null);
    t.sessions.count.mockResolvedValueOnce(150);
    const result=await t.privacy.exportSelf(me);
    expect(result.economy).toBeNull();
    expect(result.trivia).toBeNull();
    expect(result.authentication.truncated).toBe(true);
    expect(t.profiles).not.toHaveProperty('save');
  });

  it('exports guild configuration using ONLY the exact requested guild predicate',async()=>{
    const t=setup();
    t.settings.findOne.mockResolvedValueOnce({
      guildId:guild,prefix:'?',welcomeChannelId:null,welcomeMessage:'Hello',
      antiSpamEnabled:false,profanityFilterEnabled:false,blacklistedWords:[],
    });
    t.automod.find.mockResolvedValueOnce([{
      id:1,guildId:guild,name:'rule',enabled:true,kind:'blocked_phrases',
      action:'dry_run',priority:1,phrases:['word'],
      threshold:6,windowSeconds:8,exemptChannelIds:[],exemptRoleIds:[],
    }]);
    const result=await t.privacy.exportGuild(guild);
    expect(result.guildId).toBe(guild);
    expect(result.automodRules).toHaveLength(1);
    expect(t.settings.findOne).toHaveBeenCalledWith({where:{guildId:guild}});
    expect(t.automod.find).toHaveBeenCalledWith({
      where:{guildId:guild},order:{id:'ASC'},take:101,
    });
    expect(JSON.stringify(result)).not.toContain(me);
    expect(t.profiles.findOne).not.toHaveBeenCalled();
  });

  it('rejects malformed IDs before querying any personal or guild record',async()=>{
    const t=setup();
    await expect(t.privacy.exportSelf('bad')).rejects.toThrow('user');
    await expect(t.privacy.exportGuild(me+';')).rejects.toThrow('guild');
    await expect(t.privacy.eraseSelf(another+' OR 1=1')).rejects.toThrow('user');
    expect(t.profiles.findOne).not.toHaveBeenCalled();
    expect(t.settings.findOne).not.toHaveBeenCalled();
    expect(t.transaction).not.toHaveBeenCalled();
  });

  it('deletes only three caller-owned tables in ONE transaction and preserves audit',async()=>{
    const t=setup();
    const outcome=await t.privacy.eraseSelf(me);
    expect(outcome.success).toBe(true);
    expect(outcome.removed).toEqual({
      economyProfiles:1,triviaSessions:1,authSessions:1,
    });
    expect(outcome.retainedForSeparateReview).toContain('moderation_and_purge_audit');
    expect(t.transaction).toHaveBeenCalledTimes(1);
    expect(t.trivia.delete).toHaveBeenCalledWith({userId:me});
    expect(t.profiles.delete).toHaveBeenCalledWith({userId:me});
    expect(t.sessions.delete).toHaveBeenCalledWith({userId:me});
    expect(t.automod.find).not.toHaveBeenCalled();
  });

  it('is idempotent when a user has nothing left to erase',async()=>{
    const t=setup();
    t.trivia.delete.mockResolvedValue({affected:0});
    t.profiles.delete.mockResolvedValue({affected:0});
    t.sessions.delete.mockResolvedValue({affected:0});
    await expect(t.privacy.eraseSelf(me)).resolves.toMatchObject({
      success:true,
      removed:{economyProfiles:0,triviaSessions:0,authSessions:0},
    });
  });

  it('retention sweeps use DB time, 250 locked rows, and never return session IDs',async()=>{
    const t=setup();
    await expect(t.privacy.pruneExpiredEphemeral()).resolves.toEqual({
      sessions:2,triviaSessions:3,
    });
    expect(t.query).toHaveBeenCalledTimes(2);
    const [sessionsSql,sessionsArgs]=t.query.mock.calls[0];
    const [triviaSql,triviaArgs]=t.query.mock.calls[1];
    expect(sessionsSql).toContain('public.sessions');
    expect(sessionsSql).toContain('"expiresAt" <= clock_timestamp()');
    expect(sessionsSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sessionsSql).toContain('RETURNING 1');
    expect(sessionsSql).not.toContain('RETURNING "id"');
    expect(triviaSql).toContain('public.trivia_sessions');
    expect(triviaSql).toContain('clock_timestamp()');
    expect(triviaSql).toContain('FOR UPDATE SKIP LOCKED');
    expect(sessionsArgs).toEqual([250]);
    expect(triviaArgs).toEqual([250,15]);
    expect(t.profiles.delete).not.toHaveBeenCalled();
  });
});
