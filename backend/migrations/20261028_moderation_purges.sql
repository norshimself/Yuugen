-- Back up PostgreSQL and run after the existing 20261028 timeout migration.
-- Store purge audit metadata and message IDs, but NEVER message contents.
-- Additive migration; safe to rerun. Do not enable TypeORM auto-sync.
BEGIN;

CREATE TABLE IF NOT EXISTS "moderation_purges" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "channelId" VARCHAR(20) NOT NULL,
  "moderatorUserId" VARCHAR(20) NOT NULL,
  "filterUserId" VARCHAR(20) NULL,
  "reason" VARCHAR(512) NOT NULL,
  "requestedCount" INTEGER NOT NULL,
  "selectedCount" INTEGER NOT NULL,
  "scannedCount" INTEGER NOT NULL,
  "skippedOldCount" INTEGER NOT NULL DEFAULT 0,
  "skippedProtectedCount" INTEGER NOT NULL DEFAULT 0,
  "selectedMessageIds" JSONB NOT NULL,
  "deletedMessageIds" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "deletedCount" INTEGER NOT NULL DEFAULT 0,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT "CHK_moderation_purges_requested_count" CHECK ("requestedCount" BETWEEN 1 AND 100),
  CONSTRAINT "CHK_moderation_purges_deleted_count" CHECK ("deletedCount" BETWEEN 0 AND 100)
);

CREATE INDEX IF NOT EXISTS "IDX_moderation_purges_guild_created"
  ON "moderation_purges" ("guildId", "createdAt");

COMMIT;
