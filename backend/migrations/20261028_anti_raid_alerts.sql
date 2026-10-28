-- Apply to backed-up staging PostgreSQL after earlier 20261028 migrations.
-- All guilds are OFF by default; there are no Discord API side effects.
BEGIN;
CREATE TABLE IF NOT EXISTS "anti_raid_settings" (
  "guildId" VARCHAR(20) PRIMARY KEY,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "mode" VARCHAR(16) NOT NULL DEFAULT 'alert_only',
  "threshold" INTEGER NOT NULL DEFAULT 10,
  "windowSeconds" INTEGER NOT NULL DEFAULT 60,
  "minAccountAgeMinutes" INTEGER NOT NULL DEFAULT 1440,
  "alertChannelId" VARCHAR(20) NULL,
  "exemptUserIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "exemptRoleIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_anti_raid_mode" CHECK ("mode" = 'alert_only'),
  CONSTRAINT "CHK_anti_raid_threshold" CHECK ("threshold" BETWEEN 3 AND 100),
  CONSTRAINT "CHK_anti_raid_window" CHECK ("windowSeconds" BETWEEN 10 AND 600),
  CONSTRAINT "CHK_anti_raid_age" CHECK ("minAccountAgeMinutes" BETWEEN 0 AND 43200),
  CONSTRAINT "CHK_anti_raid_alert_channel" CHECK (NOT "enabled" OR "alertChannelId" IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS "anti_raid_joins" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "userId" VARCHAR(20) NOT NULL,
  "joinedAt" TIMESTAMP WITH TIME ZONE NOT NULL
);
CREATE INDEX IF NOT EXISTS "IDX_anti_raid_joins_guild_joined"
  ON "anti_raid_joins" ("guildId", "joinedAt");
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_anti_raid_join_event"
  ON "anti_raid_joins" ("guildId", "userId", "joinedAt");

CREATE TABLE IF NOT EXISTS "anti_raid_alerts" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "bucketStart" TIMESTAMP WITH TIME ZONE NOT NULL,
  "joinCount" INTEGER NOT NULL,
  "windowSeconds" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "failureReason" VARCHAR(32) NULL,
  "deliveredAt" TIMESTAMP WITH TIME ZONE NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_anti_raid_alert_status" CHECK ("status" IN ('pending', 'sent', 'failed'))
);
CREATE INDEX IF NOT EXISTS "IDX_anti_raid_alerts_guild_created"
  ON "anti_raid_alerts" ("guildId", "createdAt");
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_anti_raid_alert_bucket"
  ON "anti_raid_alerts" ("guildId", "bucketStart");
COMMIT;
