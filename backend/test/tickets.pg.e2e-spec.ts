/**
 * Opt-in, disposable PostgreSQL acceptance. Never touch staging/production.
 * Requires a CREATEDB-capable PostgreSQL 17 instance on loopback.
 * YUUGEN_TICKET_PG_ADMIN_URL=postgres://...@127.0.0.1:5432/postgres
 * YUUGEN_TICKET_PG_CONFIRM=disposable npm run test:e2e -- --runInBand tickets.pg.e2e-spec.ts
 * NOT executed until an operator provisions a disposable test database.
 */
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DataSource } from 'typeorm';
import { TicketService } from '../src/domain/tickets/ticket.service';

const ADMIN=process.env.YUUGEN_TICKET_PG_ADMIN_URL;
const enabled=!!ADMIN && process.env.YUUGEN_TICKET_PG_CONFIRM==='disposable';
const databaseTest=enabled?describe:describe.skip;
const guild='123456789012345678';
const guildB='234567890123456789';
const opener='345678901234567890';
const staff='456789012345678901';
const category='567890123456789012';
const panel='678901234567890123';
const panelMessage='789012345678901234';
const channel='890123456789012345';
const control='901234567890123456';

databaseTest('Ticket lifecycle against disposable PostgreSQL',()=>{
  const name='yuugen_ticket_it_'+randomBytes(8).toString('hex');
  let admin:DataSource;
  let dbA:DataSource;
  let dbB:DataSource;
  let a:TicketService;
  let b:TicketService;
  let created=false;

  beforeAll(async()=>{
    if(!ADMIN || process.env.NODE_ENV==='production')throw new Error('Never run ticket tests against production');
    const url=new URL(ADMIN);
    if(!['postgres:','postgresql:'].includes(url.protocol) ||
      !['localhost','127.0.0.1','[::1]'].includes(url.hostname)) {
      throw new Error('Only explicitly configured loopback PostgreSQL may create a test DB');
    }
    admin=new DataSource({type:'postgres',url:ADMIN,synchronize:false,entities:[]});
    await admin.initialize();
    await admin.query('CREATE DATABASE "'+name+'"');
    created=true;
    url.pathname='/'+name;url.search='';
    const config={type:'postgres' as const,url:url.href,synchronize:false,entities:[]};
    dbA=new DataSource(config);await dbA.initialize();
    dbB=new DataSource(config);await dbB.initialize();
    await dbA.query(readFileSync(join(process.cwd(),
      'migrations/20261031_support_tickets.sql'),'utf8'));
    a=new TicketService(dbA);b=new TicketService(dbB);
  },45000);
  afterAll(async()=>{
    if(dbA?.isInitialized)await dbA.destroy();
    if(dbB?.isInitialized)await dbB.destroy();
    if(admin?.isInitialized){
      try{if(created)await admin.query('DROP DATABASE "'+name+'" WITH (FORCE)');}
      finally{await admin.destroy();}
    }
  },30000);
  beforeEach(async()=>{
    await dbA.query('TRUNCATE public.ticket_events,public.tickets,public.ticket_configs RESTART IDENTITY');
    await a.configure({guildId:guild,categoryId:category,panelChannelId:panel,staffRoleId:staff});
    await a.bindPanel((await a.config(guild))!,panelMessage);
  });

  it('one active ticket per guild/member across two connections and one current panel',async()=>{
    const results=await Promise.all([
      a.reserve(guild,opener,panelMessage),
      b.reserve(guild,opener,panelMessage),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await b.reserve(guild,opener,'111111111111111111')).toBeNull();
    const rows=await dbA.query('SELECT count(*)::integer AS count FROM public.tickets');
    expect(rows[0].count).toBe(1);
    const audits=await dbA.query('SELECT "event" FROM public.ticket_events');
    expect(audits).toEqual([{event:'reserved'}]);
  });

  it('opens with a control message; races to claim and close have one winner',async()=>{
    const id=(await a.reserve(guild,opener,panelMessage))!;
    expect(await a.activate(guild,id,opener,channel,control)).toBe(true);
    expect(await b.activate(guild,id,opener,channel,control)).toBe(false);
    const results=await Promise.all([
      a.claim(guild,channel,staff),b.claim(guild,channel,'912345678901234567'),
    ]);
    expect(results.filter(Boolean)).toHaveLength(1);
    expect(await a.release(guild,channel,opener,false)).toBe(false);
    expect(await a.release(guild,channel,staff,true)).toBe(true);
    const closes=await Promise.all([
      a.beginClose(guild,channel,staff),b.beginClose(guild,channel,staff),
    ]);
    expect(closes.filter(Boolean)).toHaveLength(1);
    expect(await a.finishClose(guild,channel,staff,false)).toBe(true);
    expect(await b.reserve(guild,opener,panelMessage)).toBeNull();
    const rows=await dbA.query('SELECT "status","lastErrorCode" FROM public.tickets');
    expect(rows).toEqual([{status:'needs_review',lastErrorCode:'close_unknown'}]);
  });

  it('deleted channels release the active slot but leave ticket and audit history',async()=>{
    const id=(await a.reserve(guild,opener,panelMessage))!;
    await a.activate(guild,id,opener,channel,control);
    expect(await b.channelDeleted(guild,channel)).toBe(true);
    expect(await a.channelDeleted(guild,channel)).toBe(false);
    expect(await b.reserve(guild,opener,panelMessage)).not.toBeNull();
    const rows=await dbA.query(
      'SELECT "event" FROM public.ticket_events WHERE "ticketId"=$1::bigint ORDER BY id',[id]);
    expect(rows.map((r:{event:string})=>r.event))
      .toEqual(['reserved','opened','channel_deleted']);
  });

  it('old panel and foreign guild cannot reserve and uncertain creation is never replayed',async()=>{
    const id=(await a.reserve(guild,opener,panelMessage))!;
    expect(await a.markCreateFailure(guild,id,opener,false)).toBe(true);
    expect(await b.reserve(guild,opener,panelMessage)).toBeNull();
    expect(await b.reserve(guildB,opener,panelMessage)).toBeNull();
    await a.configure({guildId:guild,categoryId:category,panelChannelId:panel,staffRoleId:staff});
    expect(await a.reserve(guild,'912345678901234567',panelMessage)).toBeNull();
  });
});
