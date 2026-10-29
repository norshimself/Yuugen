-- Additive onboarding migration. Apply to backed-up staging PostgreSQL only.
-- No welcome DM, goodbye, or rules flow is enabled by this migration.
BEGIN;

ALTER TABLE "guild_settings"
  ADD COLUMN IF NOT EXISTS "goodbyeChannelId" VARCHAR(20) NULL,
  ADD COLUMN IF NOT EXISTS "goodbyeMessage" VARCHAR(1500) NOT NULL
    DEFAULT 'Goodbye {user} from {guild}.',
  ADD COLUMN IF NOT EXISTS "welcomeDmEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "welcomeDmMessage" VARCHAR(1500) NOT NULL
    DEFAULT 'Welcome to {guild}, {user}!',
  ADD COLUMN IF NOT EXISTS "rulesAcknowledgementEnabled" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "rulesChannelId" VARCHAR(20) NULL;

ALTER TABLE "guild_settings"
  DROP CONSTRAINT IF EXISTS "CHK_guild_rules_dm_enabled";
ALTER TABLE "guild_settings"
  ADD CONSTRAINT "CHK_guild_rules_dm_enabled" CHECK (
    NOT "rulesAcknowledgementEnabled" OR
    ("welcomeDmEnabled" AND "rulesChannelId" IS NOT NULL)
  );

CREATE TABLE IF NOT EXISTS "guild_onboarding_receipts" (
  "id" SERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "userId" VARCHAR(20) NOT NULL,
  "kind" VARCHAR(16) NOT NULL,
  "sessionKey" VARCHAR(16) NOT NULL,
  "occurredAt" TIMESTAMPTZ NOT NULL,
  "minuteBucket" TIMESTAMPTZ NOT NULL,
  "slot" INTEGER NOT NULL,
  "status" VARCHAR(16) NOT NULL DEFAULT 'pending',
  "failureReason" VARCHAR(32) NULL,
  "acknowledgedAt" TIMESTAMPTZ NULL,
  "deliveredAt" TIMESTAMPTZ NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_guild_onboarding_kind" CHECK (
    "kind" IN ('welcome', 'goodbye', 'welcome_dm')
  ),
  CONSTRAINT "CHK_guild_onboarding_status" CHECK (
    "status" IN ('pending', 'sent', 'failed')
  ),
  CONSTRAINT "CHK_guild_onboarding_slot" CHECK ("slot" BETWEEN 0 AND 29)
);
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_guild_onboarding_event"
  ON "guild_onboarding_receipts" ("guildId", "userId", "kind", "sessionKey");
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_guild_onboarding_first_dm"
  ON "guild_onboarding_receipts" ("guildId", "userId")
  WHERE "kind" = 'welcome_dm';
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_guild_onboarding_minute_slot"
  ON "guild_onboarding_receipts" ("guildId", "minuteBucket", "slot");
CREATE INDEX IF NOT EXISTS "IDX_guild_onboarding_created"
  ON "guild_onboarding_receipts" ("guildId", "createdAt");

COMMIT;
