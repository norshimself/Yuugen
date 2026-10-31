-- Apply after 20261028_automod_rules.sql with staging backup.
-- Adds no enabled rules and performs no Discord operations.
BEGIN;
ALTER TABLE "automod_rules"
  ADD COLUMN IF NOT EXISTS "allowedDomains" JSONB NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS "allowedInviteCodes" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "automod_rules" DROP CONSTRAINT IF EXISTS "CHK_automod_kind";
ALTER TABLE "automod_rules"
  ADD CONSTRAINT "CHK_automod_kind"
  CHECK ("kind" IN (
    'blocked_phrases', 'message_rate', 'invite_link', 'external_link',
    'mass_mentions', 'attachment_rate', 'repeated_content'
  ));
COMMIT;
