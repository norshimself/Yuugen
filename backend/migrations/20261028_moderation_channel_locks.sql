-- Channel-lock audit and concurrency. Apply AFTER moderation_purges.sql.
-- Back up PostgreSQL first. DDL does not alter Discord permissions.
BEGIN;

CREATE TABLE IF NOT EXISTS "moderation_channel_locks" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "channelId" VARCHAR(20) NOT NULL,
  "lockedByUserId" VARCHAR(20) NOT NULL,
  "lockReason" VARCHAR(512) NOT NULL,
  "originalExisted" BOOLEAN NOT NULL,
  "originalAllow" VARCHAR(80) NOT NULL,
  "originalDeny" VARCHAR(80) NOT NULL,
  "lockedAllow" VARCHAR(80) NOT NULL,
  "lockedDeny" VARCHAR(80) NOT NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'lock_pending',
  "lockedAt" TIMESTAMP WITH TIME ZONE NULL,
  "unlockedByUserId" VARCHAR(20) NULL,
  "unlockReason" VARCHAR(512) NULL,
  "unlockedAt" TIMESTAMP WITH TIME ZONE NULL,
  "lastError" VARCHAR(128) NULL,
  "lastErrorAt" TIMESTAMP WITH TIME ZONE NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_channel_locks_status" CHECK (
    "status" IN ('lock_pending', 'locked', 'unlock_pending', 'unlocked', 'failed')
  )
);

CREATE INDEX IF NOT EXISTS "IDX_channel_locks_guild_channel_created"
  ON "moderation_channel_locks" ("guildId", "channelId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_channel_locks_active"
  ON "moderation_channel_locks" ("guildId", "channelId")
  WHERE "status" IN ('lock_pending', 'locked', 'unlock_pending');

COMMIT;
