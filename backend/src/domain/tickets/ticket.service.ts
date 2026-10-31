import { BadRequestException, Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { requireTicketId, validTicketSetup } from './ticket-policy';

export type TicketStatus = 'provisioning'|'open'|'closing'|'needs_review'|'closed'|'deleted'|'failed';
export interface TicketConfig {
  guildId:string; categoryId:string; panelChannelId:string; staffRoleId:string;
  panelMessageId:string|null;
}
export interface TicketRecord {
  id:string; guildId:string; openerId:string; channelId:string|null;
  controlMessageId:string|null; status:TicketStatus;
  claimedById:string|null;
}

const CONFIG = 'public.ticket_configs';
const TICKETS = 'public.tickets';
const EVENTS = 'public.ticket_events';

function validSequence(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{1,19}$/.test(value)) return false;
  const n = BigInt(value);
  return n > 0n && n <= 9223372036854775807n;
}
function snowflake(value: unknown, label: string): asserts value is string {
  try { requireTicketId(value, label); }
  catch { throw new BadRequestException('Invalid ' + label); }
}

/** All mutating statements use single PostgreSQL CTEs for audit atomicity. */
@Injectable()
export class TicketService {
  constructor(private readonly db: DataSource) {}

  private async first<T>(sql:string,args:unknown[]):Promise<T|null> {
    const rows:T[] = await this.db.query(sql,args);
    return rows[0] || null;
  }

  async config(guildId:string):Promise<TicketConfig|null> {
    snowflake(guildId,'guild ID');
    return this.first<TicketConfig>(
      `SELECT "guildId","categoryId","panelChannelId","staffRoleId","panelMessageId"
       FROM ${CONFIG} WHERE "guildId"=$1`,[guildId]);
  }

  async configure(input:Omit<TicketConfig,'panelMessageId'>):Promise<TicketConfig> {
    if (!validTicketSetup(input)) throw new BadRequestException('Invalid ticket configuration');
    const row=await this.first<TicketConfig>(
      `INSERT INTO ${CONFIG} ("guildId","categoryId","panelChannelId","staffRoleId")
       VALUES ($1,$2,$3,$4)
       ON CONFLICT ("guildId") DO UPDATE SET
         "categoryId"=EXCLUDED."categoryId",
         "panelChannelId"=EXCLUDED."panelChannelId",
         "staffRoleId"=EXCLUDED."staffRoleId",
         "panelMessageId"=NULL,"updatedAt"=clock_timestamp()
       RETURNING "guildId","categoryId","panelChannelId","staffRoleId","panelMessageId"`,
      [input.guildId,input.categoryId,input.panelChannelId,input.staffRoleId]);
    if (!row) throw new Error('Ticket configuration was not saved');
    return row;
  }

  async bindPanel(config:TicketConfig,messageId:string):Promise<boolean> {
    snowflake(messageId,'panel message ID');
    const result=await this.first<{guildId:string}>(
      `UPDATE ${CONFIG} SET "panelMessageId"=$5,"updatedAt"=clock_timestamp()
       WHERE "guildId"=$1 AND "categoryId"=$2 AND "panelChannelId"=$3
         AND "staffRoleId"=$4 RETURNING "guildId"`,
      [config.guildId,config.categoryId,config.panelChannelId,config.staffRoleId,messageId]);
    return result!==null;
  }

  /** Atomic one-active-ticket reservation. A crashed create is NOT retried. */
  async reserve(guildId:string,openerId:string,panelMessageId:string):Promise<string|null> {
    snowflake(guildId,'guild ID');snowflake(openerId,'opener ID');
    snowflake(panelMessageId,'panel message ID');
    const row=await this.first<{id:string}>(
      `WITH inserted AS (
        INSERT INTO ${TICKETS} ("guildId","openerId")
        SELECT $1,$2 FROM ${CONFIG}
        WHERE "guildId"=$1 AND "panelMessageId"=$3
        ON CONFLICT DO NOTHING RETURNING id,"guildId"
      ), audit AS (
        INSERT INTO ${EVENTS} ("ticketId","guildId","actorId","event")
        SELECT id,"guildId",$2,'reserved' FROM inserted
      ) SELECT id::text AS id FROM inserted`,[guildId,openerId,panelMessageId]);
    return row?.id || null;
  }

  /** Once a private channel and its controls exist, expose it as open. */
  async activate(guildId:string,id:string,openerId:string,
    channelId:string,controlMessageId:string):Promise<boolean> {
    snowflake(guildId,'guild ID');snowflake(openerId,'opener ID');
    snowflake(channelId,'ticket channel ID');snowflake(controlMessageId,'control message ID');
    if(!validSequence(id))throw new BadRequestException('Invalid ticket number');
    const row=await this.first<{id:string}>(
      `WITH changed AS (
        UPDATE ${TICKETS} SET "status"='open',"channelId"=$4,
          "controlMessageId"=$5,"updatedAt"=clock_timestamp()
        WHERE id=$1::bigint AND "guildId"=$2 AND "openerId"=$3
          AND "status"='provisioning' AND "channelId" IS NULL
        RETURNING id,"guildId"
      ), audit AS (
        INSERT INTO ${EVENTS} ("ticketId","guildId","actorId","event")
        SELECT id,"guildId",$3,'opened' FROM changed
      ) SELECT id::text AS id FROM changed`,
      [id,guildId,openerId,channelId,controlMessageId]);
    return !!row;
  }

  /** Failed permission validation is known-no-effect; network timeout is NOT. */
  async markCreateFailure(guildId:string,id:string,openerId:string,
    knownNoEffect:boolean):Promise<boolean> {
    snowflake(guildId,'guild ID');snowflake(openerId,'opener ID');
    if(!validSequence(id))throw new BadRequestException('Invalid ticket number');
    const status=knownNoEffect?'failed':'needs_review';
    const reason=knownNoEffect?'create_rejected':'create_unknown';
    const event=knownNoEffect?'create_failed':'needs_review';
    const row=await this.first<{id:string}>(
      `WITH changed AS (
        UPDATE ${TICKETS} SET "status"=$4,"lastErrorCode"=$5,
          "updatedAt"=clock_timestamp()
        WHERE id=$1::bigint AND "guildId"=$2 AND "openerId"=$3
          AND "status"='provisioning' RETURNING id,"guildId"
      ), audit AS (
        INSERT INTO ${EVENTS} ("ticketId","guildId","actorId","event","reasonCode")
        SELECT id,"guildId",$3,$6,$5 FROM changed
      ) SELECT id::text AS id FROM changed`,
      [id,guildId,openerId,status,reason,event]);
    return !!row;
  }

  /** All control buttons must belong to the persisted message and channel. */
  async byChannel(guildId:string,channelId:string):Promise<TicketRecord|null> {
    snowflake(guildId,'guild ID');snowflake(channelId,'channel ID');
    return this.first<TicketRecord>(
      `SELECT id::text AS id,"guildId","openerId","channelId",
         "controlMessageId","status","claimedById"
       FROM ${TICKETS} WHERE "guildId"=$1 AND "channelId"=$2`,
      [guildId,channelId]);
  }

  async claim(guildId:string,channelId:string,actorId:string):Promise<boolean> {
    snowflake(guildId,'guild ID');snowflake(channelId,'channel ID');snowflake(actorId,'actor ID');
    const row=await this.first<{id:string}>(
      `WITH changed AS (
        UPDATE ${TICKETS} SET "claimedById"=$3,"updatedAt"=clock_timestamp()
        WHERE "guildId"=$1 AND "channelId"=$2 AND "status"='open'
          AND "claimedById" IS NULL RETURNING id,"guildId"
      ), audit AS (
        INSERT INTO ${EVENTS} ("ticketId","guildId","actorId","event")
        SELECT id,"guildId",$3,'claimed' FROM changed
      ) SELECT id::text AS id FROM changed`,[guildId,channelId,actorId]);
    return !!row;
  }

  async release(guildId:string,channelId:string,actorId:string,
    managerOverride=false):Promise<boolean> {
    snowflake(guildId,'guild ID');snowflake(channelId,'channel ID');snowflake(actorId,'actor ID');
    const row=await this.first<{id:string}>(
      `WITH changed AS (
        UPDATE ${TICKETS} SET "claimedById"=NULL,"updatedAt"=clock_timestamp()
        WHERE "guildId"=$1 AND "channelId"=$2 AND "status"='open'
          AND "claimedById" IS NOT NULL
          AND ("claimedById"=$3 OR $4::boolean) RETURNING id,"guildId"
      ), audit AS (
        INSERT INTO ${EVENTS} ("ticketId","guildId","actorId","event")
        SELECT id,"guildId",$3,'released' FROM changed
      ) SELECT id::text AS id FROM changed`,
      [guildId,channelId,actorId,managerOverride]);
    return !!row;
  }

  /** Prepare a Discord permission edit; keep the active slot until finalized. */
  async beginClose(guildId:string,channelId:string,actorId:string):Promise<TicketRecord|null> {
    snowflake(guildId,'guild ID');snowflake(channelId,'channel ID');snowflake(actorId,'actor ID');
    return this.first<TicketRecord>(
      `WITH changed AS (
        UPDATE ${TICKETS} SET "status"='closing',"updatedAt"=clock_timestamp()
        WHERE "guildId"=$1 AND "channelId"=$2 AND "status"='open'
        RETURNING id,"guildId","openerId","channelId","controlMessageId", "status","claimedById"
      ), audit AS (
        INSERT INTO ${EVENTS} ("ticketId","guildId","actorId","event")
        SELECT id,"guildId",$3,'close_requested' FROM changed
      ) SELECT id::text AS id,"guildId","openerId","channelId",
        "controlMessageId","status","claimedById" FROM changed`,
      [guildId,channelId,actorId]);
  }

  async finishClose(guildId:string,channelId:string,actorId:string,
    confirmed:boolean):Promise<boolean> {
    snowflake(guildId,'guild ID');snowflake(channelId,'channel ID');snowflake(actorId,'actor ID');
    const status=confirmed?'closed':'needs_review';
    const event=confirmed?'closed':'needs_review';
    const row=await this.first<{id:string}>(
      `WITH changed AS (
        UPDATE ${TICKETS} SET "status"=$4,"closedById"=CASE WHEN $5::boolean THEN $3 ELSE NULL END,
          "closedAt"=CASE WHEN $5::boolean THEN clock_timestamp() ELSE NULL END,
          "lastErrorCode"=CASE WHEN $5::boolean THEN NULL ELSE 'close_unknown' END,
          "updatedAt"=clock_timestamp()
        WHERE "guildId"=$1 AND "channelId"=$2 AND "status"='closing'
        RETURNING id,"guildId"
      ), audit AS (
        INSERT INTO ${EVENTS} ("ticketId","guildId","actorId","event","reasonCode")
        SELECT id,"guildId",$3,$6,
          CASE WHEN $5::boolean THEN NULL ELSE 'close_unknown' END FROM changed
      ) SELECT id::text AS id FROM changed`,
      [guildId,channelId,actorId,status,confirmed,event]);
    return !!row;
  }

  /** Gateway event is authoritative for removal; no accidental auto-recreation. */
  async channelDeleted(guildId:string,channelId:string):Promise<boolean> {
    snowflake(guildId,'guild ID');snowflake(channelId,'channel ID');
    const row=await this.first<{id:string}>(
      `WITH changed AS (
        UPDATE ${TICKETS} SET "status"='deleted',
          "updatedAt"=clock_timestamp()
        WHERE "guildId"=$1 AND "channelId"=$2
          AND "status" IN ('open','closing','closed','needs_review')
        RETURNING id,"guildId"
      ), audit AS (
        INSERT INTO ${EVENTS} ("ticketId","guildId","event","reasonCode")
        SELECT id,"guildId",'channel_deleted','discord_channel_deleted' FROM changed
      ) SELECT id::text AS id FROM changed`,[guildId,channelId]);
    return !!row;
  }

  /** Metadata-only recovery listing. An operator must reconcile unknown effects. */
  async unresolved(guildId:string):Promise<Array<{id:string;status:TicketStatus;
    openerId:string;channelId:string|null;lastErrorCode:string|null}>> {
    snowflake(guildId,'guild ID');
    return this.db.query(
      `SELECT id::text AS id,"status","openerId","channelId","lastErrorCode"
       FROM ${TICKETS} WHERE "guildId"=$1
         AND "status" IN ('provisioning','closing','needs_review')
       ORDER BY "createdAt" ASC,id ASC LIMIT 20`,[guildId]);
  }
}
