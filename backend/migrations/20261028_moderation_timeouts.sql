-- Non-destructive migration. Apply AFTER 20261020_moderation_warnings.sql,
-- and BEFORE deploying the bot with timeout moderation commands.
-- Back up PostgreSQL first. Safe to re-run.
BEGIN;

ALTER TABLE "moderation_cases"
  ADD COLUMN IF NOT EXISTS "expiresAt" TIMESTAMP WITH TIME ZONE NULL;

COMMIT;
