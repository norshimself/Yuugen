-- Apply after moderation_voice.sql, with a PostgreSQL backup.
-- Rules are OFF by default. No Discord messages/actions are changed by DDL.
BEGIN;
CREATE TABLE IF NOT EXISTS "automod_rules" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "name" VARCHAR(48) NOT NULL,
  "enabled" BOOLEAN NOT NULL DEFAULT FALSE,
  "kind" VARCHAR(24) NOT NULL,
  "action" VARCHAR(16) NOT NULL DEFAULT 'dry_run',
  "priority" INTEGER NOT NULL DEFAULT 100,
  "phrases" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "threshold" INTEGER NOT NULL DEFAULT 6,
  "windowSeconds" INTEGER NOT NULL DEFAULT 8,
  "exemptChannelIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "exemptRoleIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_automod_kind" CHECK ("kind" IN ('blocked_phrases', 'message_rate')),
  CONSTRAINT "CHK_automod_action" CHECK ("action" IN ('dry_run', 'delete')),
  CONSTRAINT "CHK_automod_priority" CHECK ("priority" BETWEEN 0 AND 10000)
);
CREATE INDEX IF NOT EXISTS "IDX_automod_rules_guild_priority"
  ON "automod_rules" ("guildId", "priority", "id");
COMMIT;
