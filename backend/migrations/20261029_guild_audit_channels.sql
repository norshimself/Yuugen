-- Apply after existing 20261028 moderation migrations to backed-up staging.
-- All guilds are disabled; no existing messages or Discord settings are changed.
BEGIN;
CREATE TABLE IF NOT EXISTS "guild_audit_configs" (
  "guildId" VARCHAR(20) PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "logChannelId" VARCHAR(20) NULL,
  "selectedEvents" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_guild_audit_enabled" CHECK (NOT "enabled" OR "logChannelId" IS NOT NULL),
  CONSTRAINT "CHK_guild_audit_events_array" CHECK (jsonb_typeof("selectedEvents") = 'array')
);
CREATE TABLE IF NOT EXISTS "guild_audit_events" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "eventKey" VARCHAR(96) NOT NULL,
  "eventType" VARCHAR(24) NOT NULL,
  "targetId" VARCHAR(20) NULL,
  "sourceChannelId" VARCHAR(20) NULL,
  "actorId" VARCHAR(20) NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "minuteBucket" TIMESTAMPTZ NOT NULL,
  "slot" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "failureReason" VARCHAR(32) NULL,
  "deliveredAt" TIMESTAMPTZ NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_guild_audit_type" CHECK ("eventType" IN (
    'message_edit', 'message_delete', 'member_join', 'member_departure',
    'member_ban', 'member_kick', 'member_timeout'
  )),
  CONSTRAINT "CHK_guild_audit_status" CHECK ("status" IN ('pending', 'sent', 'failed')),
  CONSTRAINT "CHK_guild_audit_slot" CHECK ("slot" BETWEEN 0 AND 19)
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_guild_audit_event_key"
  ON "guild_audit_events" ("guildId", "eventKey");
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_guild_audit_minute_slot"
  ON "guild_audit_events" ("guildId", "minuteBucket", "slot");
CREATE INDEX IF NOT EXISTS "IDX_guild_audit_created"
  ON "guild_audit_events" ("guildId", "createdAt");
COMMIT;
