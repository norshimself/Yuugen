-- Staging only. Apply to a backed-up PostgreSQL DB after prior moderation migrations.
-- No guild role is modified or panel published by this schema change.
BEGIN;
CREATE TABLE IF NOT EXISTS "role_panels" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "channelId" VARCHAR(20) NOT NULL,
  "messageId" VARCHAR(20) NULL,
  "title" VARCHAR(100) NOT NULL,
  "mode" VARCHAR(12) NOT NULL,
  "status" VARCHAR(12) NOT NULL DEFAULT 'draft',
  "revision" INTEGER NOT NULL DEFAULT 0,
  "options" JSONB NOT NULL DEFAULT '[]'::jsonb,
  "createdByUserId" VARCHAR(20) NOT NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_role_panel_mode" CHECK ("mode" IN ('buttons', 'select')),
  CONSTRAINT "CHK_role_panel_status" CHECK (
    "status" IN ('draft', 'publishing', 'active', 'disabled')
  ),
  CONSTRAINT "CHK_role_panel_revision" CHECK ("revision" >= 0),
  CONSTRAINT "CHK_role_panel_options" CHECK (
    jsonb_typeof("options") = 'array' AND jsonb_array_length("options") <= 25
  )
);
CREATE INDEX IF NOT EXISTS "IDX_role_panels_guild_status"
  ON "role_panels" ("guildId", "status");
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_role_panel_message"
  ON "role_panels" ("guildId", "messageId")
  WHERE "messageId" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "role_panel_member_locks" (
  "guildId" VARCHAR(20) NOT NULL,
  "userId" VARCHAR(20) NOT NULL,
  "token" VARCHAR(36) NULL,
  "expiresAt" TIMESTAMPTZ NOT NULL DEFAULT TO_TIMESTAMP(0),
  "lastActionAt" TIMESTAMPTZ NULL,
  PRIMARY KEY ("guildId", "userId")
);

CREATE TABLE IF NOT EXISTS "role_panel_actions" (
  "id" SERIAL PRIMARY KEY,
  "interactionId" VARCHAR(20) NOT NULL,
  "guildId" VARCHAR(20) NOT NULL,
  "userId" VARCHAR(20) NOT NULL,
  "panelId" INTEGER NOT NULL,
  "optionId" INTEGER NOT NULL,
  "roleId" VARCHAR(20) NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_role_panel_action_status" CHECK (
    "status" IN ('pending', 'added', 'removed', 'partial', 'uncertain', 'denied')
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_role_panel_action_interaction"
  ON "role_panel_actions" ("interactionId");
CREATE INDEX IF NOT EXISTS "IDX_role_panel_actions_guild_created"
  ON "role_panel_actions" ("guildId", "createdAt");
COMMIT;
