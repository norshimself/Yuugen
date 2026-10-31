-- #65: additive, metadata-only guild support tickets.
-- Apply only after backup / staging review. No Discord calls or channel creation.
BEGIN;

CREATE TABLE IF NOT EXISTS "ticket_configs" (
  "guildId" VARCHAR(20) PRIMARY KEY,
  "categoryId" VARCHAR(20) NOT NULL,
  "panelChannelId" VARCHAR(20) NOT NULL,
  "staffRoleId" VARCHAR(20) NOT NULL,
  "panelMessageId" VARCHAR(20) NULL,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_ticket_config_staff" CHECK ("staffRoleId" <> "guildId"),
  CONSTRAINT "CHK_ticket_config_channel" CHECK ("categoryId" <> "panelChannelId")
);

CREATE TABLE IF NOT EXISTS "tickets" (
  "id" BIGSERIAL PRIMARY KEY,
  "guildId" VARCHAR(20) NOT NULL,
  "openerId" VARCHAR(20) NOT NULL,
  "staffRoleId" VARCHAR(20) NOT NULL,
  "channelId" VARCHAR(20) UNIQUE NULL,
  "controlMessageId" VARCHAR(20) NULL,
  "status" VARCHAR(24) NOT NULL DEFAULT 'provisioning',
  "claimedById" VARCHAR(20) NULL,
  "closedById" VARCHAR(20) NULL,
  "closedAt" TIMESTAMPTZ NULL,
  "lastErrorCode" VARCHAR(32) NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_ticket_status" CHECK (
    "status" IN ('provisioning','open','closing','needs_review','closed','deleted','failed')
  ),
  CONSTRAINT "CHK_ticket_channel_open" CHECK (
    "status" <> 'open' OR ("channelId" IS NOT NULL AND "controlMessageId" IS NOT NULL)
  ),
  CONSTRAINT "CHK_ticket_claim_open" CHECK (
    "claimedById" IS NULL OR "status" IN ('open','closing','needs_review','closed','deleted')
  )
);

-- One active/provisioning/uncertain ticket per guild member, atomically
-- across multiple bot processes. Unknown Discord create outcomes hold slots.
CREATE UNIQUE INDEX IF NOT EXISTS "UQ_tickets_guild_opener_active"
  ON "tickets" ("guildId", "openerId")
  WHERE "status" IN ('provisioning','open','closing','needs_review');
CREATE INDEX IF NOT EXISTS "IDX_tickets_guild_status_created"
  ON "tickets" ("guildId","status","createdAt");

CREATE TABLE IF NOT EXISTS "ticket_events" (
  "id" BIGSERIAL PRIMARY KEY,
  "ticketId" BIGINT NOT NULL REFERENCES "tickets" ("id") ON DELETE RESTRICT,
  "guildId" VARCHAR(20) NOT NULL,
  "actorId" VARCHAR(20) NULL,
  "event" VARCHAR(32) NOT NULL,
  "reasonCode" VARCHAR(32) NULL,
  "createdAt" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CHK_ticket_event" CHECK (
    "event" IN ('reserved','opened','create_failed','needs_review',
                'claimed','released','close_requested','closed','channel_deleted')
  )
);
CREATE INDEX IF NOT EXISTS "IDX_ticket_events_ticket_created"
  ON "ticket_events" ("ticketId","createdAt","id");

COMMIT;
