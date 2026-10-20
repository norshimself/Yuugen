-- Run after taking a database backup, BEFORE deploying moderation commands.
-- Global bot economy is unaffected. Warning histories are guild-specific.
-- Safe to re-run: the table and index are created only if absent.
BEGIN;

CREATE TABLE IF NOT EXISTS "moderation_cases" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "targetUserId" VARCHAR(20) NOT NULL,
  "moderatorUserId" VARCHAR(20) NOT NULL,
  "action" VARCHAR(24) NOT NULL DEFAULT 'warn',
  "reason" VARCHAR(512) NOT NULL,
  "createdAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP WITH TIME ZONE NULL,
  "revokedByUserId" VARCHAR(20) NULL,
  "revocationReason" VARCHAR(512) NULL
);

CREATE INDEX IF NOT EXISTS "IDX_moderation_cases_guild_target_created"
  ON "moderation_cases" ("guildId", "targetUserId", "createdAt");

COMMIT;
