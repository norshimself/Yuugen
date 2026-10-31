-- Stacked on issue #60. Apply AFTER 20261029_guild_audit_channels.sql
-- to a backed-up staging database. No existing guild setting is enabled.
BEGIN;

ALTER TABLE "guild_audit_configs"
  ADD COLUMN IF NOT EXISTS "retentionDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "guild_audit_configs"
  DROP CONSTRAINT IF EXISTS "CHK_guild_audit_retention";
ALTER TABLE "guild_audit_configs"
  ADD CONSTRAINT "CHK_guild_audit_retention"
  CHECK ("retentionDays" BETWEEN 1 AND 30);

ALTER TABLE "guild_audit_events"
  ADD COLUMN IF NOT EXISTS "changedFields" JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "guild_audit_events"
  DROP CONSTRAINT IF EXISTS "CHK_guild_audit_changed_fields";
ALTER TABLE "guild_audit_events"
  ADD CONSTRAINT "CHK_guild_audit_changed_fields"
  CHECK (jsonb_typeof("changedFields") = 'array' AND
         jsonb_array_length("changedFields") <= 12);

ALTER TABLE "guild_audit_events"
  DROP CONSTRAINT IF EXISTS "CHK_guild_audit_type";
ALTER TABLE "guild_audit_events"
  ADD CONSTRAINT "CHK_guild_audit_type"
  CHECK ("eventType" IN (
    'message_edit', 'message_delete',
    'member_join', 'member_departure', 'member_ban',
    'member_kick', 'member_timeout',
    'role_create', 'role_update', 'role_delete',
    'member_role_update',
    'channel_create', 'channel_update', 'channel_delete',
    'webhook_create', 'webhook_update', 'webhook_delete',
    'permission_change'
  ));

COMMIT;
