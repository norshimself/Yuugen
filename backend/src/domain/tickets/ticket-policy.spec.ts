import {
  TICKET_FEATURE_FLAG, MAX_ACTIVE_TICKETS_PER_USER,
  isDefinitiveChannelCreateRejection, privateTicketOverwrites,
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
