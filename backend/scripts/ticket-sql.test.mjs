import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';

const root = new URL('../', import.meta.url);
const sql = readFileSync(new URL('migrations/20261031_support_tickets.sql', root), 'utf8');
const service = readFileSync(new URL('src/domain/tickets/ticket.service.ts', root), 'utf8');
const commands = readFileSync(new URL('src/bot/commands/tickets/ticket.command.ts', root), 'utf8');

// This lightweight test checks static contracts, not live PostgreSQL behavior.
test('migration is atomic and stores metadata, not ticket message content', () => {
  assert.match(sql, /^--[^]*\nBEGIN;/);
  assert.match(sql, /\nCOMMIT;\s*$/);
  for (const table of ['ticket_configs','tickets','ticket_events']) {
    assert.ok(sql.includes(`CREATE TABLE IF NOT EXISTS "${table}"`));
  }
  assert.doesNotMatch(sql, /"(transcript|messageContent|attachmentUrl)"/i);
});

test('one active slot is unique across processes, including uncertain creation and closure', () => {
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tickets_guild_opener_active"/);
  assert.match(sql, /ON "tickets" \("guildId", "openerId"\)/);
  assert.match(sql, /WHERE "status" IN \('provisioning','open','closing','needs_review'\)/);
  assert.match(sql, /"staffRoleId" VARCHAR\(20\) NOT NULL/);
  assert.match(sql, /CONSTRAINT "CHK_ticket_channel_open"/);
});

test('ticket lifecycle retains an append-only audit and no cascading delete', () => {
  assert.match(sql, /"ticketId" BIGINT NOT NULL REFERENCES "tickets" \("id"\) ON DELETE RESTRICT/);
  for (const event of ['reserved','opened','create_failed','needs_review','claimed',
    'released','close_requested','closed','channel_deleted']) {
    assert.ok(sql.includes(`'${event}'`), `missing audit event: ${event}`);
  }
  assert.doesNotMatch(sql, /DROP (TABLE|COLUMN)|TRUNCATE|CASCADE\b/);
});

test('service uses parameterized, guild-scoped single-statement transitions', () => {
  assert.match(service, /ON CONFLICT DO NOTHING RETURNING id,"guildId"/);
  assert.match(service, /"panelMessageId"=\$3/);
  assert.match(service, /AND \("claimedById"=\$3 OR \$4::boolean\)/);
  assert.match(service, /AND "status"='closing'/);
  assert.match(service, /AND "status"='provisioning'/);
  assert.match(service, /INSERT INTO \$\{EVENTS\}/);
  assert.match(service, /LIMIT 20/);
});

test('Discord flow is opt-in, checks live member permissions and never falls back to public channel', () => {
  assert.match(commands, /TICKET_FEATURE_FLAG/);
  assert.match(commands, /force:true/);
  assert.match(commands, /privateTicketOverwrites\(/);
  assert.match(commands, /const ticketId=await this\.tickets\.reserve/);
  assert.match(commands, /markCreateFailure\(/);
  assert.match(commands, /permissionOverwrites\.edit/);
  assert.match(commands, /allowedMentions:\{parse:\[\]\}/);
  assert.doesNotMatch(commands, /permissionOverwrites:\s*\[\]/);
});
