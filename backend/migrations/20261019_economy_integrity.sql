-- Non-destructive PostgreSQL migration for the existing global Yuugen economy.
-- Apply BEFORE deploying the backend code that references these columns.
-- Backup the database first. Safe to re-run: every DDL statement is idempotent.
BEGIN;

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "lastRps" TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE "user_profiles"
  ADD COLUMN IF NOT EXISTS "lastTrivia" TIMESTAMP WITHOUT TIME ZONE;

ALTER TABLE "trivia_sessions"
  ADD COLUMN IF NOT EXISTS "questionId" INTEGER;

ALTER TABLE "trivia_sessions"
  ADD COLUMN IF NOT EXISTS "messageId" VARCHAR;

CREATE INDEX IF NOT EXISTS "IDX_trivia_sessions_createdAt"
  ON "trivia_sessions" ("createdAt");

COMMIT;
