import {
  assertClaimedJob, assertSnowflake, normalizeJob, parseUtcInstant, retryDelaySeconds,
  transitionFor, type NewScheduledJob,
} from './scheduler-policy';

const guildId = '123456789012345678';
const valid: NewScheduledJob = {
  guildId,kind:'reminder_send',idempotencyKey:'reminder:11223344',
  payload:{reminderId:10},runAt:'2026-10-31T01:30:00Z',
};

describe('scheduler policy: bounded, UTC-only, metadata-only jobs', () => {
  it('accepts an explicit UTC instant during DST transitions', () => {
    expect(parseUtcInstant('2026-03-29T01:30:00Z').toISOString())
      .toBe('2026-03-29T01:30:00.000Z');
    expect(parseUtcInstant('2026-10-25T01:30:00Z').toISOString())
      .toBe('2026-10-25T01:30:00.000Z');
  });

  it.each(['2026-10-25T01:30:00','2026-10-25 01:30',
    '2026-10-25T01:30:00+01:00','2026-02-30T01:30:00Z',
    '2026-11-01T25:30:00Z','tomorrow',''])(
    'rejects local, offset, invalid or ambiguous timestamps: %s',
    (runAt) => expect(() => parseUtcInstant(runAt)).toThrow(),
  );

  it('parses correct fractional precision and rejects invalid day rollovers', () => {
    expect(parseUtcInstant('2026-10-30T12:01:02.5Z').toISOString())
      .toBe('2026-10-30T12:01:02.500Z');
    expect(() => parseUtcInstant('2026-04-31T01:00:00Z')).toThrow();
  });

  it('normalizes minimally scoped IDs rather than arbitrary content', () => {
    expect(normalizeJob(valid)).toEqual({...valid,maxAttempts:5});
    expect(normalizeJob({...valid,kind:'temporary_unban',
      payload:{targetUserId:'234567890123456789',moderationCaseId:55}}).kind)
      .toBe('temporary_unban');
    expect(normalizeJob({...valid,kind:'giveaway_close',payload:{giveawayId:7}}).kind)
      .toBe('giveaway_close');
    expect(normalizeJob({...valid,kind:'event_notice',payload:{eventId:3}}).kind)
      .toBe('event_notice');
  });

  it('blocks invalid guild IDs, unsupported jobs and dangerous keys', () => {
    expect(() => assertSnowflake('bad','guild')).toThrow();
    expect(() => normalizeJob({...valid,guildId:'123'})).toThrow('guild');
    expect(() => normalizeJob({...valid,kind:'eval' as any})).toThrow('Unsupported');
    expect(() => normalizeJob({...valid,idempotencyKey:'hello; DROP TABLE'}))
      .toThrow('idempotency');
    expect(() => normalizeJob({...valid,maxAttempts:11})).toThrow('maxAttempts');
    expect(() => normalizeJob({...valid,maxAttempts:0})).toThrow('maxAttempts');
  });

  it('rejects user-controlled text or unapproved fields inside payloads', () => {
    expect(() => normalizeJob({...valid,payload:{
      reminderId:10,messageContent:'@everyone please click here',
    } as any})).toThrow('payload');
    expect(() => normalizeJob({...valid,payload:{reminderId:-1}})).toThrow('reminder');
    expect(() => normalizeJob({...valid,payload:{reminderId:1.5}})).toThrow('reminder');
    expect(() => normalizeJob({...valid,kind:'temporary_unban',
      payload:{targetUserId:'bad',moderationCaseId:1}})).toThrow('target');
    expect(() => normalizeJob({...valid,payload:[] as any})).toThrow('payload');
  });

  it('does not depend on server local timezone for retry timing', () => {
    expect(retryDelaySeconds('11',1)).toBe(5);
    expect(retryDelaySeconds('12',2)).toBe(11);
    expect(retryDelaySeconds('11',10)).toBe(900);
    expect(() => retryDelaySeconds('bad',1)).toThrow();
    expect(() => retryDelaySeconds('11',0)).toThrow();
  });

  it('classifies known no-side-effect failures as bounded retries', () => {
    expect(transitionFor('11',1,5,
      {outcome:'retry',reasonCode:'rate_limited'})).toEqual({
      status:'pending',reasonCode:'rate_limited',retryDelaySeconds:5,
    });
    expect(transitionFor('11',5,5,
      {outcome:'retry',reasonCode:'rate_limited'})).toEqual({
      status:'dead',reasonCode:'retry_exhausted',retryDelaySeconds:null,
    });
  });

  it('parks ambiguous outcomes rather than retrying unknown side effects', () => {
    expect(transitionFor('11',2,5,{
      outcome:'needs_review',reasonCode:'unknown_outcome',
    })).toEqual({
      status:'needs_review',reasonCode:'unknown_outcome',retryDelaySeconds:null,
    });
  });

  it('keeps completed and canceled final, no accidental retry', () => {
    expect(transitionFor('11',1,5,{outcome:'completed'}).status).toBe('completed');
    expect(transitionFor('11',1,5,{outcome:'canceled',reasonCode:'target_missing'}).status)
      .toBe('canceled');
  });

  it('requires fixed safe reason codes and bounded attempt counts', () => {
    expect(() => transitionFor('11',1,5,
      {outcome:'retry',reasonCode:'raw provider error with token'})).toThrow('reason');
    expect(() => transitionFor('11',0,5,{outcome:'completed'})).toThrow('attempt');
    expect(() => transitionFor('11',6,5,{outcome:'completed'})).toThrow('attempt');
  });
  it('validates every claimed database row, not only enqueue inputs',()=>{
    const claimed = {
      id:'9223372036854775807', guildId,
      kind:'reminder_send',payload:{reminderId:10},
      attempts:1,maxAttempts:5,
      leaseToken:'44444444-4444-4444-4444-444444444444',
      leaseOwner:'worker-1',cancelRequested:false,
    };
    expect(()=>assertClaimedJob(claimed)).not.toThrow();
    expect(()=>assertClaimedJob({...claimed,payload:{
      reminderId:10,messageContent:'@everyone',
    }})).toThrow('payload');
    expect(()=>assertClaimedJob({...claimed,payload:{reminderId:0}}))
      .toThrow('reminder');
    expect(()=>assertClaimedJob({...claimed,id:'9223372036854775808'}))
      .toThrow('job ID');
    expect(()=>assertClaimedJob({...claimed,attempts:6}))
      .toThrow('attempt');
    expect(()=>assertClaimedJob({...claimed,leaseToken:'malformed'}))
      .toThrow('lease');
    expect(()=>assertClaimedJob({...claimed,cancelRequested:'false'}))
      .toThrow('lease');
  });

});
