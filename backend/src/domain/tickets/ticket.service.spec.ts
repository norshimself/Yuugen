import { DataSource } from 'typeorm';
import { TicketService } from './ticket.service';

const guild='123456789012345678';
const opener='234567890123456789';
const category='345678901234567890';
const panelChannel='456789012345678901';
const staff='567890123456789012';
const panelMessage='678901234567890123';
const channel='789012345678901234';
const controls='890123456789012345';

function setup(){
 const query=jest.fn().mockResolvedValue([]);
 return {query,svc:new TicketService({query} as unknown as DataSource)};
}

describe('TicketService PostgreSQL race fences and guild isolation',()=>{
 it('configures a guild independently, invalidates old panels on change',async()=>{
   const {query,svc}=setup();
   query.mockResolvedValueOnce([{guildId:guild,staffRoleId:staff}]);
   await svc.configure({guildId:guild,categoryId:category,panelChannelId:panelChannel,staffRoleId:staff});
   const [sql,args]=query.mock.calls[0];
   expect(args).toEqual([guild,category,panelChannel,staff]);
   expect(sql).toContain('ON CONFLICT ("guildId")');
   expect(sql).toContain('"panelMessageId"=NULL');
   expect(sql).not.toContain('DELETE FROM');
 });
 it('binds only an exact matching configuration snapshot',async()=>{
   const {query,svc}=setup();
   const config={guildId:guild,categoryId:category,panelChannelId:panelChannel,
     staffRoleId:staff,panelMessageId:null};
   query.mockResolvedValueOnce([{guildId:guild}]).mockResolvedValueOnce([]);
   expect(await svc.bindPanel(config,panelMessage)).toBe(true);
   expect(await svc.bindPanel(config,panelMessage)).toBe(false);
   expect(query.mock.calls[0][1]).toEqual([guild,category,panelChannel,staff,panelMessage]);
 });
 it('reserves only through a current panel; DB unique constraint enforces concurrency',async()=>{
   const {query,svc}=setup();
   query.mockResolvedValueOnce([{id:'7'}]).mockResolvedValueOnce([]);
   expect(await svc.reserve(guild,opener,panelMessage)).toBe('7');
   expect(await svc.reserve(guild,opener,panelMessage)).toBeNull();
   const [sql,args]=query.mock.calls[0];
   expect(args).toEqual([guild,opener,panelMessage]);
   expect(sql).toContain('"panelMessageId"=$3');
   expect(sql).toContain('"staffRoleId" FROM');
   expect(sql).toContain('ON CONFLICT DO NOTHING');
   expect(sql).toContain("'reserved'");
 });
 it('only opens reserved tickets with both a private channel and control message',async()=>{
   const {query,svc}=setup();
   query.mockResolvedValueOnce([{id:'7'}]);
   expect(await svc.activate(guild,'7',opener,channel,controls)).toBe(true);
   const [sql,args]=query.mock.calls[0];
   expect(args).toEqual(['7',guild,opener,channel,controls]);
   expect(sql).toContain("AND \"status\"='provisioning'");
   expect(sql).toContain('"channelId" IS NULL');
   expect(sql).toContain("'opened'");
 });
 it('known no-effect create errors release slot; network ambiguity stays in needs_review',async()=>{
   const {query,svc}=setup();
   query.mockResolvedValue([{id:'7'}]);
   expect(await svc.markCreateFailure(guild,'7',opener,true)).toBe(true);
   expect(query.mock.calls[0][1]).toEqual(['7',guild,opener,'failed','create_rejected','create_failed']);
   expect(await svc.markCreateFailure(guild,'7',opener,false)).toBe(true);
   expect(query.mock.calls[1][1]).toEqual(['7',guild,opener,'needs_review','create_unknown','needs_review']);
   expect(query.mock.calls[1][0]).toContain("AND \"status\"='provisioning'");
 });
 it('fetches ticket controls only within the exact guild and channel',async()=>{
   const {query,svc}=setup();
   query.mockResolvedValueOnce([{id:'7',guildId:guild,staffRoleId:staff}]);
   const t=await svc.byChannel(guild,channel);
   expect(t?.staffRoleId).toBe(staff);
   expect(query.mock.calls[0][1]).toEqual([guild,channel]);
 });
 it('uses conditional single-winner claim and claimant-only release, with audited events',async()=>{
   const {query,svc}=setup();
   query.mockResolvedValueOnce([{id:'7'}]).mockResolvedValueOnce([])
     .mockResolvedValueOnce([{id:'7'}]);
   expect(await svc.claim(guild,channel,staff)).toBe(true);
   expect(await svc.claim(guild,channel,staff)).toBe(false);
   expect(await svc.release(guild,channel,staff,false)).toBe(true);
   expect(query.mock.calls[0][0]).toContain('"claimedById" IS NULL');
   expect(query.mock.calls[0][0]).toContain("'claimed'");
   expect(query.mock.calls[2][0]).toContain('"claimedById"=$3 OR $4::boolean');
   expect(query.mock.calls[2][1]).toEqual([guild,channel,staff,false]);
 });
 it('fences the two-stage closing and preserves uncertain remote outcomes',async()=>{
   const {query,svc}=setup();
   query.mockResolvedValue([{id:'7',openerId:opener,status:'closing'}]);
   expect((await svc.beginClose(guild,channel,staff))?.status).toBe('closing');
   expect(await svc.finishClose(guild,channel,staff,true)).toBe(true);
   expect(await svc.finishClose(guild,channel,staff,false)).toBe(true);
   expect(query.mock.calls[0][0]).toContain("AND \"status\"='open'");
   expect(query.mock.calls[0][0]).toContain("'close_requested'");
   expect(query.mock.calls[1][1]).toEqual([guild,channel,staff,'closed',true,'closed']);
   expect(query.mock.calls[2][1]).toEqual([guild,channel,staff,'needs_review',false,'needs_review']);
   expect(query.mock.calls[2][0]).toContain("'close_unknown'");
 });
 it('records unexpected deletion only for a bound matching guild channel',async()=>{
   const {query,svc}=setup();
   query.mockResolvedValueOnce([{id:'7'}]);
   expect(await svc.channelDeleted(guild,channel)).toBe(true);
   expect(query.mock.calls[0][1]).toEqual([guild,channel]);
   expect(query.mock.calls[0][0]).toContain("'channel_deleted'");
 });
 it('reports unresolved tickets as bounded metadata without message transcripts',async()=>{
   const {query,svc}=setup();
   query.mockResolvedValueOnce([]);
   expect(await svc.unresolved(guild)).toEqual([]);
   const [sql,args]=query.mock.calls[0];
   expect(args).toEqual([guild]);
   expect(sql).toContain('LIMIT 20');
   expect(sql).not.toContain('content');
 });
 it('fails invalid identifiers before SQL and never interpolates user IDs into queries',async()=>{
   const {query,svc}=setup();
   await expect(svc.reserve('bad',opener,panelMessage)).rejects.toThrow();
   await expect(svc.claim(guild,'1 OR 1=1',staff)).rejects.toThrow();
   await expect(svc.activate(guild,'7;DELETE',opener,channel,controls)).rejects.toThrow();
   expect(query).not.toHaveBeenCalled();
 });
});
