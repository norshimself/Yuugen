-- Voice moderation audit and cross-process pending-action lock.
-- Apply after 20261028_moderation_channel_locks.sql.
-- Back up PostgreSQL first. This migration does not change Discord voice state.
BEGIN;

CREATE TABLE IF NOT EXISTS "moderation_voice_cases" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "moderatorUserId" VARCHAR(20) NOT NULL,
  "targetUserId" VARCHAR(20) NOT NULL,
  "action" VARCHAR(24) NOT NULL,
  "sourceChannelId" VARCHAR(20) NOT NULL,
  "destinationChannelId" VARCHAR(20) NULL,
  "reason" VARCHAR(512) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "lastError" VARCHAR(128) NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finishedAt" TIMESTAMP WITH TIME ZONE NULL,
  CONSTRAINT "CHK_moderation_voice_action" CHECK (
    "action" IN ('mute', 'unmute', 'deafen', 'undeafen', 'disconnect', 'move')
  ),
  CONSTRAINT "CHK_moderation_voice_status" CHECK (
    "status" IN ('pending', 'completed', 'failed')
  ),
  CONSTRAINT "CHK_moderation_voice_destination" CHECK (
    ("action" = 'move' AND "destinationChannelId" IS NOT NULL AND
      "destinationChannelId" <> "sourceChannelId")
    OR ("action" <> 'move' AND "destinationChannelId" IS NULL)
  )
);

CREATE INDEX IF NOT EXISTS "IDX_moderation_voice_guild_target_created"
  ON "moderation_voice_cases" ("guildId", "targetUserId", "createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "UQ_moderation_voice_pending"
  ON "moderation_voice_cases" ("guildId", "targetUserId")
  WHERE "status" = 'pending';

COMMIT;
