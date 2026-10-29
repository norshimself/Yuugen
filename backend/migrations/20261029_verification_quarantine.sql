-- Depends on 20261029_self_role_panels.sql (#63), but creates no roles.
-- Apply only to backed-up staging PostgreSQL; no Discord side effects.
BEGIN;
CREATE TABLE IF NOT EXISTS "guild_verification_configs" (
  "guildId" VARCHAR(20) PRIMARY KEY,
  "channelId" VARCHAR(20) NOT NULL,
  "quarantineRoleId" VARCHAR(20) NOT NULL,
  "messageId" VARCHAR(20) NULL,
  "mode" VARCHAR(12) NOT NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 1,
  "questionPrompt" VARCHAR(140) NULL,
  "answerSalt" VARCHAR(32) NULL,
  "answerDigest" VARCHAR(64) NULL,
  "updatedByUserId" VARCHAR(20) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_verify_mode" CHECK ("mode" IN ('button','question')),
  CONSTRAINT "CHK_verify_status" CHECK (
    "status" IN ('draft','publishing','active','disabled')
  ),
  CONSTRAINT "CHK_verify_revision" CHECK ("revision" BETWEEN 1 AND 999999999),
  CONSTRAINT "CHK_verify_question" CHECK (
    "mode" = 'button' OR
    ("questionPrompt" IS NOT NULL AND "answerSalt" IS NOT NULL AND "answerDigest" IS NOT NULL)
  )
);
CREATE TABLE IF NOT EXISTS "guild_verification_sessions" (
  "guildId" VARCHAR(20) NOT NULL,
  "userId" VARCHAR(20) NOT NULL,
  "sessionKey" VARCHAR(16) NOT NULL,
  "quarantineRoleId" VARCHAR(20) NOT NULL,
  "status" VARCHAR(24) NOT NULL,
  "claimToken" VARCHAR(36) NULL,
  "wrongAnswers" INTEGER NOT NULL DEFAULT 0,
  "releasedAt" TIMESTAMPTZ NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY ("guildId", "userId"),
  CONSTRAINT "CHK_verify_session_status" CHECK ("status" IN (
    'join_pending', 'quarantined', 'join_failed', 'join_uncertain',
    'release_pending', 'release_uncertain', 'released'
  )),
  CONSTRAINT "CHK_verify_wrong_answers" CHECK ("wrongAnswers" BETWEEN 0 AND 5),
  CONSTRAINT "CHK_verify_join_key" CHECK ("sessionKey" ~ '^[0-9]{12,16}$')
);
CREATE INDEX IF NOT EXISTS "IDX_guild_verify_session_status"
  ON "guild_verification_sessions" ("guildId","status");
CREATE TABLE IF NOT EXISTS "guild_verification_actions" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "eventKey" VARCHAR(96) NOT NULL,
  "userId" VARCHAR(20) NOT NULL,
  "actorId" VARCHAR(20) NOT NULL,
  "sessionKey" VARCHAR(16) NOT NULL,
  "action" VARCHAR(24) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_verify_action" CHECK (
    "action" IN ('join','verify','wrong_answer','override')
  ),
  CONSTRAINT "CHK_verify_action_result" CHECK (
    "status" IN ('pending','succeeded','denied','failed','uncertain')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_verify_action_event"
  ON "guild_verification_actions" ("guildId","eventKey");
CREATE INDEX IF NOT EXISTS "IDX_verify_action_guild_time"
  ON "guild_verification_actions" ("guildId","createdAt");
COMMIT;
