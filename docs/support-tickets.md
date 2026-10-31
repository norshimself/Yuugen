# Private support tickets — issue #65

**Status: source implementation only.** No staging or production deployment,
database migration, or real Discord testing has been carried out. The feature
ships disabled with ENABLE_TICKETS=false. GitHub Actions remain disabled.

## Permission and privacy model

This implementation uses dedicated PRIVATE Discord text channels, not threads.
A channel is created with explicit permission overwrites: the guild @everyone
role is denied View Channel; only the opener, configured support role and bot
are explicitly allowed View Channel, Send Messages and Read History. The bot
also receives Manage Channels. **Discord guild Administrators can bypass
channel overwrites.** Choosing a staff role held by ordinary members exposes
ticket content to them, so the selected staff role must be restricted.

Yuugen stores only guild, opener, staff-role, channel and control-message IDs,
ticket states, claim/close actor IDs, timestamps and short fixed error codes.
It does NOT store message contents, attachments or transcripts. Discord still
retains messages inside its channel. The audit table has no automatic deletion;
review retention and subject access under issue #91. Transcripts, reopening,
SLA alerts, ratings and participant management belong to issue #66.

## Deployment prerequisites

1. Back up a DISPOSABLE PostgreSQL 17 staging database and apply previously
   reviewed 20261019, 20261020 and 20261028 migrations in sequence.
   Then review and apply backend/migrations/20261031_support_tickets.sql.
   Integrate this file with migration runner issue #89 / draft PR #109 once
   that prerequisite is approved. Never enable TypeORM production auto-sync.
2. Verify three new tables: ticket_configs, tickets and ticket_events. The
   partial unique index UQ_tickets_guild_opener_active permits at most one
   provisioning/open/closing/needs_review ticket per guild member. Events
   have a restrictive foreign key and are not deleted by cascading tickets.
3. In a disposable Discord guild, enable ENABLE_TICKETS=true on a separate
   test bot only AFTER database setup. Other environments keep it false.
   The bot needs Manage Channels and access/posting rights in the selected
   category/panel. No Message Content privileged intent is required.

An install with the flag off performs no ticket database/Discord operations
in the ticket commands.

## Commands and lifecycle

A fresh Manage Server member configures a category, staff role and panel text
channel with:

    /ticket setup category:<category> staff_role:<role> panel_channel:<channel>

This validates guild ownership of each resource and bot permissions.
Changing configuration invalidates old panel messages. It does not
retroactively change overwrites on existing channels: staff role changes
must be reviewed against all old tickets.

Then the manager publishes a button with:

    /ticket panel

Only the exact current panel message can create a ticket. The member clicks
"Open private ticket" and the bot force-fetches membership and checks
category, staff role and bot rights. A database reservation happens BEFORE
any Discord channel creation. The bot creates a private text channel, posts
Claim/Release/Close controls and marks the ticket open only after the channel
and control message exist.

Support staff with the ticket's PERSISTED role (or a freshly validated Manage
Server member) may press those control buttons inside the ticket. Claim has
one winner; Release requires the claimant or a manager. Close is a two-stage
operation: first save a pending audit record, then deny the opener normal
messages, thread messages, public/private thread creation and reactions.
After confirmed Discord success it becomes closed. The Discord channel is
retained privately and readable; no transcript download or destructive
channel deletion is performed.

An unexpected channelDelete gateway event marks the matching ticket deleted
and permits a future ticket from the same member. If the bot was offline
during deletion, the event may be missed; staff must reconcile it manually.
A restart does not recreate channels or replay uncertain remote requests.

## Failure handling and manual review

The command /ticket review is restricted to Manage Server and lists up to
20 unresolved, metadata-only records from the current guild. It includes
provisioning, closing and needs_review states, not user messages or tokens.

Known Discord create rejections 50001/50013/50035 may be marked failed when
no channel exists, allowing a new attempt. A network timeout, unknown
acknowledgment, crash or failure after a channel is created is uncertain:
the ticket remains needs_review and its unique active slot stays reserved.
No automatic second channel is created. An unknown close outcome similarly
requires staff to inspect actual channel posting permissions before any
manual correction. Use the ticket sequence in the channel name/topic to
inspect possible orphan channels.

Closing a ticket does not revoke existing guild Administrator access. If
a support role is changed, review the old channels' permission overwrites.
The feature currently has no automatic post-crash reconciliation or
user-facing reopen button. These remain operational/review follow-ups.

## Disposable staging acceptance and rollback

1. Run full backend npm ci, NestJS build, actual Jest and e2e, and frontend
   checks. The committed lightweight backend/scripts/ticket-sql.test.mjs
   runs without npm dependencies but checks static contracts only.
2. In a disposable local PostgreSQL instance, run the opt-in two-connection
   test suite backend/test/tickets.pg.e2e-spec.ts. It creates and drops its own
   random database and validates one active slot, claims, close, deletion and
   audit history. NEVER point the test at a production DB or port-forward;
   loopback alone does not guarantee the server is disposable. This suite
   has NOT been executed in the current environment.
3. Run setup and panel as a manager, then try as a non-manager. Deny
   Everyone as a staff role and try foreign category/channel/role IDs.
   Verify effective Discord permissions of private channels as real staff,
   ordinary member, another guild member and guild Administrator.
4. Repeatedly click Open Ticket from two clients or bot processes. Confirm
   only one channel and one active DB ticket exist. Retry after restart and
   after intentionally lost Discord acknowledgements (disposable guild only).
   Confirm the bot never auto-replays uncertain creation.
5. With two staff users, race Claim, Release and Close; revoke the staff
   role between button display and click. Only legitimate staff can modify
   tickets. After close, the opener cannot send normal/thread messages,
   start threads or react. Retain the private channel and its audit.
6. Delete a ticket channel while the bot is connected, then during bot
   downtime, and verify online deletion audit and manual offline recovery.
   Also verify /ticket review does not leak third-party messages or secrets.
7. Review privacy retention (#91), backup restore, operator reconciliation
   and bot permission boundaries before any production consideration.

For the disposable DB suite, run from backend with these variables:

    YUUGEN_TICKET_PG_ADMIN_URL=postgres://testuser:localpass@127.0.0.1:5432/postgres
    YUUGEN_TICKET_PG_CONFIRM=disposable

Then execute: npm run test:e2e -- --runInBand tickets.pg.e2e-spec.ts

**Rollback:** switch ENABLE_TICKETS=false and restart. This prevents new
ticket actions, but DOES NOT delete already created Discord channels or
revoke existing role access. Do not drop audit tables or restore deleted
Discord content by rolling back code. Incident cleanup needs independent
staff authorization. No production action is authorized by issue creation.

**Remaining blockers:** full real NestJS/Jest, PostgreSQL 17, Discord guild
permission/privacy acceptance, and safe operator reconciliation for unknown
outcomes. Keep issue #65 and the draft PR open until those are satisfied.
