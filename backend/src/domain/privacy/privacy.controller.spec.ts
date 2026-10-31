import 'reflect-metadata';
import { BadRequestException, UnauthorizedException } from '@nestjs/common';
import { PrivacySelfController, PrivacyGuildController } from './privacy.controller';
import { PrivacyService } from './privacy.service';
import { JwtAuthGuard } from '../../api/auth/jwt-auth.guard';
import { FirstPartyRequestGuard } from '../../api/auth/first-party-request.guard';
import { GuildAccessGuard } from '../../api/auth/guild-access.guard';
import { PRIVACY_ERASURE_CONFIRMATION, PRIVACY_ERASURE_SCOPE } from './privacy-policy';

const me='123456789012345678';
const guild='234567890123456789';
function setup(){
  const svc={
    exportSelf:jest.fn().mockResolvedValue({userId:me}),
    eraseSelf:jest.fn().mockResolvedValue({success:true}),
    exportGuild:jest.fn().mockResolvedValue({guildId:guild}),
  };
  const self=new PrivacySelfController(svc as unknown as PrivacyService);
  const manager=new PrivacyGuildController(svc as unknown as PrivacyService);
  const response={clearCookie:jest.fn()};
  return {svc,self,manager,response};
}

describe('Privacy routes: authenticated self actions and live guild manager guards',()=>{
  it('guards self identity with JWT and destructive operations with first-party JSON',()=>{
    const classGuards=Reflect.getMetadata('__guards__',PrivacySelfController) as Function[];
    const eraseGuards=Reflect.getMetadata(
      '__guards__',PrivacySelfController.prototype.erase,
    ) as Function[];
    expect(classGuards).toContain(JwtAuthGuard);
    expect(eraseGuards).toContain(FirstPartyRequestGuard);
  });

  it('requires live guild Manage Server rights for guild exports',()=>{
    const guards=Reflect.getMetadata('__guards__',PrivacyGuildController) as Function[];
    expect(guards).toContain(JwtAuthGuard);
    expect(guards).toContain(GuildAccessGuard);
    expect(Reflect.getMetadata('yuugen:requireGuildManager',PrivacyGuildController))
      .toBe(true);
    expect(Reflect.getMetadata('yuugen:allowGuildless',PrivacyGuildController))
      .not.toBe(true);
  });

  it('exports from the verified JWT caller, not from query or body target IDs',async()=>{
    const t=setup();
    expect(await t.self.export({user:{id:me}})).toEqual({userId:me});
    expect(t.svc.exportSelf).toHaveBeenCalledWith(me);
    expect(await t.manager.export(guild)).toEqual({guildId:guild});
    expect(t.svc.exportGuild).toHaveBeenCalledWith(guild);
  });

  it('requires explicit exact erasure confirmation and clears auth cookies after commit',async()=>{
    const t=setup();
    const body={confirmation:PRIVACY_ERASURE_CONFIRMATION,scope:PRIVACY_ERASURE_SCOPE};
    expect(await t.self.erase({user:{id:me}},body,t.response)).toEqual({
      success:true,
    });
    expect(t.svc.eraseSelf).toHaveBeenCalledWith(me);
    expect(t.response.clearCookie).toHaveBeenCalledWith(
      'yuugen_session',expect.objectContaining({path:'/api/v1/auth'}),
    );
    expect(t.response.clearCookie).toHaveBeenCalledWith(
      'session_id',{path:'/'},
    );
  });

  it.each([
    null,{},[],{confirmation:'yes',scope:PRIVACY_ERASURE_SCOPE},
    {confirmation:PRIVACY_ERASURE_CONFIRMATION,scope:'everything'},
    {
      confirmation:PRIVACY_ERASURE_CONFIRMATION,
      scope:PRIVACY_ERASURE_SCOPE,targetUserId:guild,
    },
  ])('refuses unconfirmed/overbroad deletion without a database write: %j',async(body)=>{
    const t=setup();
    await expect(t.self.erase({user:{id:me}},body,t.response))
      .rejects.toBeInstanceOf(BadRequestException);
    expect(t.svc.eraseSelf).not.toHaveBeenCalled();
    expect(t.response.clearCookie).not.toHaveBeenCalled();
  });

  it('does not accept demo users or missing authenticated identities',async()=>{
    const t=setup();
    await expect(t.self.export({user:{id:'demo_user'}}))
      .rejects.toBeInstanceOf(UnauthorizedException);
    await expect(t.self.erase({},{
      confirmation:PRIVACY_ERASURE_CONFIRMATION,
      scope:PRIVACY_ERASURE_SCOPE,
    },t.response)).rejects.toBeInstanceOf(UnauthorizedException);
    expect(t.svc.exportSelf).not.toHaveBeenCalled();
    expect(t.svc.eraseSelf).not.toHaveBeenCalled();
  });

  it('keeps cookies if the erasure transaction fails',async()=>{
    const t=setup();
    t.svc.eraseSelf.mockRejectedValueOnce(new Error('Database unavailable'));
    await expect(t.self.erase({user:{id:me}},{
      confirmation:PRIVACY_ERASURE_CONFIRMATION,scope:PRIVACY_ERASURE_SCOPE,
    },t.response)).rejects.toThrow('Database unavailable');
    expect(t.response.clearCookie).not.toHaveBeenCalled();
  });
});
