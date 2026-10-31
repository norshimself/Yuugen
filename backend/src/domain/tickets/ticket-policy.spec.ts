import {
  TICKET_FEATURE_FLAG, MAX_ACTIVE_TICKETS_PER_USER,
  isDefinitiveChannelCreateRejection, privateTicketOverwrites,
  hasExactPrivateTicketOverwrites,
  requireTicketId, ticketChannelName, ticketStaffAllowed, validTicketSetup,
} from './ticket-policy';

const guild='123456789012345678';
const opener='234567890123456789';
const staff='345678901234567890';
const bot='456789012345678901';
const bits={ViewChannel:1024n,SendMessages:2048n,
  ReadMessageHistory:65536n,ManageChannels:16n};

describe('Private ticket policy',()=>{
  it('defaults to a separate disabled feature and one active ticket',()=>{
    expect(TICKET_FEATURE_FLAG).toBe('ENABLE_TICKETS');
    expect(MAX_ACTIVE_TICKETS_PER_USER).toBe(1);
  });
  it('rejects invalid snowflakes and everyone as a staff role',()=>{
    expect(()=>requireTicketId('invalid','member')).toThrow('Invalid member');
    expect(()=>requireTicketId(opener,'member')).not.toThrow();
    expect(validTicketSetup({guildId:guild,categoryId:opener,
      panelChannelId:bot,staffRoleId:staff})).toBe(true);
    expect(validTicketSetup({guildId:guild,categoryId:opener,
      panelChannelId:bot,staffRoleId:guild})).toBe(false);
    expect(validTicketSetup({guildId:guild,categoryId:opener,
      panelChannelId:opener,staffRoleId:staff})).toBe(false);
  });
  it('denies everyone viewing while explicitly allowing only opener, staff and bot',()=>{
    const rows=privateTicketOverwrites(guild,opener,staff,bot,bits);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({id:guild,deny:[bits.ViewChannel]});
    expect(rows[1]).toEqual({id:opener,
      allow:[bits.ViewChannel,bits.SendMessages,bits.ReadMessageHistory]});
    expect(rows[2].id).toBe(staff);
    expect(rows[3]).toEqual({id:bot,
      allow:[bits.ViewChannel,bits.SendMessages,bits.ReadMessageHistory,bits.ManageChannels]});
    expect(rows.filter(row=>row.id===guild && 'allow' in row)).toHaveLength(0);
  });
  it('checks the full provider overwrite set rather than only everyone visibility',()=>{
    const view = bits.ViewChannel;
    const row = (id:string,type:number,allow:boolean,deny:boolean)=>({
      id,type,allow:{has:(bit:bigint)=>bit===view && allow},
      deny:{has:(bit:bigint)=>bit===view && deny},
    });
    const valid = [
      row(guild,0,false,true),row(opener,1,true,false),
      row(staff,0,true,false),row(bot,1,true,false),
    ];
    const check = (entries:typeof valid)=>
      hasExactPrivateTicketOverwrites(entries,guild,opener,staff,bot,view);
    expect(check(valid)).toBe(true);
    expect(check([...valid,row('567890123456789012',0,true,false)])).toBe(false);
    expect(check([...valid,row('567890123456789012',1,true,false)])).toBe(false);
    expect(check(valid.slice(1))).toBe(false);
    expect(check([valid[0],valid[1],valid[2],valid[2]])).toBe(false);
    expect(check([row(guild,0,true,true),...valid.slice(1)])).toBe(false);
    expect(check([valid[0],row(opener,1,false,false),...valid.slice(2)])).toBe(false);
    expect(check([row(guild,1,false,true),...valid.slice(1)])).toBe(false);
    expect(check([valid[0],valid[1],row(staff,0,false,true),valid[3]])).toBe(false);
  });
  it('refuses colliding permission principals (no public fallback)',()=>{
    expect(()=>privateTicketOverwrites(guild,opener,guild,bot,bits))
      .toThrow('Conflicting');
    expect(()=>privateTicketOverwrites(guild,opener,opener,bot,bits))
      .toThrow('Conflicting');
    expect(()=>privateTicketOverwrites(guild,opener,staff,'bad',bits)).toThrow('Invalid bot');
  });
  it('requires the persisted staff role or fresh Manage Server permission',()=>{
    expect(ticketStaffAllowed([staff],staff,false)).toBe(true);
    expect(ticketStaffAllowed([opener],staff,false)).toBe(false);
    expect(ticketStaffAllowed([],staff,true)).toBe(true);
  });
  it('only classifies known Discord authorization/validation rejects as no-effect',()=>{
    for(const code of [50001,50013,50035]) {
      expect(isDefinitiveChannelCreateRejection({code})).toBe(true);
    }
    for(const err of [null,new Error('timeout'),{code:10003},{code:500},{code:'50013'}]) {
      expect(isDefinitiveChannelCreateRejection(err)).toBe(false);
    }
  });
  it('generates deterministic private channel names from database sequence only',()=>{
    expect(ticketChannelName('24')).toBe('ticket-24');
    expect(ticketChannelName('9223372036854775807')).toBe('ticket-9223372036854775807');
    expect(()=>ticketChannelName('9223372036854775808')).toThrow();
    for(const value of ['0','abc','1; @everyone','-4']) {
      expect(()=>ticketChannelName(value)).toThrow();
    }
  });
});
