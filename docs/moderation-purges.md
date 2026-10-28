# Yuugen moderation: safe message purge (issue #53)

This implements `/mod purge` in the existing moderation group and adds an
independent, guild-scoped `moderation_purges` audit table.

## Command

`/mod purge count:<1-100> reason:<text> [user:<user>] [user_id:<snowflake>] [channel:<text channel>]`

- `count`: number of eligible messages to delete, **1 to 100**.
- `reason`: mandatory audit reason, 1 to 512 characters.
- `user` or `user_id`: optional author filter; supply at most one.
  `user_id` supports messages by users who have already left the guild.
- `channel`: optional server text/announcement channel; defaults to the
  channel where the command was invoked. Threads and forum channels are
  deliberately unsupported in this first version.
- Results are **not guaranteed to reach the requested count**: the bot
  scans up to 500 recent messages and selects at most 100 eligible items.

No Message Content privileged intent is needed to filter by author ID, and
Yuugen does not inspect or store message contents.

## Permission and safety rules

1. Both the human moderator and the bot must have **Manage Messages**
   and **View Channel** permissions **in the target channel**. Yuugen
   additionally needs **Read Message History**. These are checked
   at preview and again immediately before deletion, with fresh guild
   member and channel fetches.
2. The bot reads only the most recent **five pages of 100 messages**.
   It never searches an unlimited message history or deletes by a
   guessed/count-only bulk request.
3. It **skips pinned, system and non-deletable messages**, as well as any
   messages at or past a conservative two-week cutoff. A five-minute buffer
   prevents messages near Discord's 14-day bulk-delete limit from expiring
   during the 60-second confirmation window.
4. The preview lists the precise number of selected messages, scanned
   count, exclusions, channel and optional author. It also explains when
   fewer messages than requested were found.
5. The **Confirm / Cancel** buttons are private, belong to the original
   moderator and guild, and expire in **60 seconds**. Confirm is consumed
   synchronously to prevent double clicks from executing twice.
6. On confirmation, the bot **re-fetches messages with caching disabled**
   and compares the **full ordered set of message IDs** with the preview.
   If a message was deleted, pinned, aged out, replaced in the scan, or
   newer messages changed the selection, the purge is canceled. The
   moderator must preview a fresh selection.
7. Only one purge at a time is allowed in a channel **within a bot process**.
   This is not yet a distributed lock across multiple independent workers;
   multi-process deployments need a shared lease/queue before rollout.
8. Discord's bulk-delete endpoint accepts **2–100 message IDs**, all
   younger than two weeks. Yuugen uses normal single-message deletion
   for a one-message selection and Discord.js `bulkDelete(messages, true)`
   for 2–100, with the old-message safety filter.
9. API failures are never retried automatically. A definitive rejection
   is marked failed; uncertain network outcomes remain pending and must
   be reviewed before repeating an action.

Discord API age restriction: see the official bulk-delete documentation,
which refuses requests containing messages older than two weeks.

## Persistent audit

`moderation_purges` captures:

- guild, channel, moderator, optional author-filter user ID
- moderator's reason, requested/selected/scanned counts and exclusions
- selected and deleted Discord **message IDs**, without contents,
  attachments, embeds or author profile data
- pending/completed/partial/failed status, timestamps and deletion count

A pending audit record is saved **before Discord is asked to delete**.
If the database is unavailable, no messages are deleted. The audit is
conditionally finalized after a confirmed Discord result.

- **completed**: Discord reports the selected message IDs as deleted
- **partial**: Discord reports fewer deleted IDs than requested
- **failed**: Discord definitively rejects the request or reports zero IDs
- **pending**: the bot crashed, Discord's response was inconclusive, or
  the database could not finalize the audit after a response

Do **not** treat `pending` as "nothing deleted". An administrator should
inspect the channel and stored message IDs before deciding whether to
retry. The bot does not expose purge history through a public API yet.

Message IDs are personal metadata. Before broad public deployment, define
an audit-retention schedule and user-data handling policy (see privacy
backlog issue #91); access to the PostgreSQL table must be staff-restricted.

## Required PostgreSQL migration

After taking a PostgreSQL backup, apply migrations in order if they have
not already been applied. **Do not run them against production as part
of feature development**:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261019_economy_integrity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261020_moderation_warnings.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261028_moderation_timeouts.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261028_moderation_purges.sql
```

The new migration creates the `moderation_purges` table and a guild/date
index. No existing moderation or economy rows are modified. Production
TypeORM schema synchronization must remain disabled. **Apply the table
migration before running the backend that registers `/mod purge`.**

## Staging acceptance checklist

Run from a network-connected checkout:

```bash
cd backend
npm ci
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Use a disposable Discord guild and test messages only.

1. Verify a regular member lacking Manage Messages cannot preview or
   execute a purge. Verify a moderator who has permission globally but
   not in the selected channel is also rejected.
2. Remove Manage Messages, Read Message History or View Channel from
   the bot; every missing requirement must block the action.
3. Preview `count:5`: nothing is deleted before confirmation.
   Cancel and verify no messages or audit rows change.
4. Confirm the same request: only the exact previewed message IDs are
   removed and the metadata-only audit is completed.
5. Try `count:1`; ensure the single-message deletion API is used.
6. Try count 0/101, empty/oversized reasons, invalid author IDs and
   conflicting user filters. Each must be rejected.
7. Test the optional channel and author filters, including the raw ID
   of a member who left the guild. No other channel should be affected.
8. Pin a message and confirm it is skipped. Test a message older than
   two weeks; it must never be bulk-deleted. Check the five-minute margin.
9. Flood the channel with new messages, delete a selected message, or
   pin one between preview and confirmation. The request must be canceled
   when the selection changes.
10. Have someone else click Confirm, attempt another guild, let the
    confirmation expire, cancel it and double-click it; none may create
    a second deletion.
11. Run two overlapping purge confirmations in the same channel; only
    one operation can proceed while another is active.
12. Simulate audit database outage before the delete: **no deletion**.
13. Simulate Discord 403, a lost network response and an audit DB
    finalization failure. Verify failed/pending states and honest replies.
14. Simulate a partial result and confirm it reports deleted/selected
    counts without inventing successful deletions.
15. Restart the bot and verify persisted audit history; old ephemeral
    confirmation buttons must be invalid.
16. Repeat the checks with two guilds to confirm strict audit isolation.

No GitHub Actions are restored. No production deployment, database
migration, real message deletion or guild mutation was performed by
the feature PR. Do not mark issue #53 released until staging sign-off.
