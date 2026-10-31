-- Staging only, after existing 20261028 moderation migrations and a DB backup.
-- Anti-nuke is disabled by default. No Discord permissions are changed.
BEGIN;
CREATE TABLE IF NOT EXISTS "anti_nuke_settings" (
  "guildId" VARCHAR(20) PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "mode" VARCHAR(16) NOT NULL DEFAULT 'alert_only',
  "threshold" INTEGER NOT NULL DEFAULT 3,
  "windowSeconds" INTEGER NOT NULL DEFAULT 60,
  "alertChannelId" VARCHAR(20) NULL,
  "exemptActorIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_anti_nuke_mode" CHECK ("mode" = 'alert_only'),
  CONSTRAINT "CHK_anti_nuke_threshold" CHECK ("threshold" BETWEEN 3 AND 30),
  CONSTRAINT "CHK_anti_nuke_window" CHECK ("windowSeconds" BETWEEN 10 AND 600),
  CONSTRAINT "CHK_anti_nuke_alert_channel" CHECK (NOT "enabled" OR "alertChannelId" IS NOT NULL)
);
CREATE TABLE IF NOT EXISTS "anti_nuke_events" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "auditEntryId" VARCHAR(20) NOT NULL,
  "kind" VARCHAR(32) NOT NULL,
  "targetId" VARCHAR(20) NULL,
  "actorId" VARCHAR(20) NULL,
  "eventAt" TIMESTAMPTZ NOT NULL,
  CONSTRAINT "CHK_anti_nuke_event_kind" CHECK ("kind" IN (
    'channel_delete', 'role_delete', 'webhook_delete', 'permission_escalation'
  ))
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_anti_nuke_guild_audit"
  ON "anti_nuke_events" ("guildId", "auditEntryId");
CREATE INDEX IF NOT EXISTS "IDX_anti_nuke_guild_time"
  ON "anti_nuke_events" ("guildId", "eventAt");
CREATE TABLE IF NOT EXISTS "anti_nuke_alerts" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "bucketStart" TIMESTAMPTZ NOT NULL,
  "eventCount" INTEGER NOT NULL,
  "windowSeconds" INTEGER NOT NULL,
  "triggeredBy" VARCHAR(32) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "deliveredAt" TIMESTAMPTZ NULL,
  "failureReason" VARCHAR(32) NULL,
  "reviewedById" VARCHAR(20) NULL,
  "disposition" VARCHAR(16) NULL,
  "reviewedAt" TIMESTAMPTZ NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_anti_nuke_alert_status" CHECK ("status" IN ('pending', 'sent', 'failed')),
  CONSTRAINT "CHK_anti_nuke_alert_disposition" CHECK (
    "disposition" IS NULL OR "disposition" IN ('legitimate', 'suspicious')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_anti_nuke_alert_bucket"
  ON "anti_nuke_alerts" ("guildId", "bucketStart");
CREATE INDEX IF NOT EXISTS "IDX_anti_nuke_alerts_guild_created"
  ON "anti_nuke_alerts" ("guildId", "createdAt");
COMMIT;
