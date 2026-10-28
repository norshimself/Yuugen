# Yuugen moderation: channel lock and unlock (issue #54)

This adds three moderator-only slash subcommands:

- /mod lock reason:<text> [channel:<text or announcement channel>]
- /mod unlock reason:<text> [channel:<text or announcement channel>]
- /mod lockstatus [channel:<text or announcement channel>]

If no channel is supplied, the interaction's current text channel is used.
All replies are ephemeral and permission-checked. Only normal guild text
and announcement channels are supported in this initial version—no forums,
threads, categories, stages, or voice channels.

## Important scope: this is a base lock, not a total freeze

Yuugen only changes the **@everyone** channel overwrite for
**Send Messages**, setting it to **Deny**. Other permission bits are
untouched. Any existing explicit role/member allowance can still permit
sending messages, and Discord Administrators bypass channel restrictions.
This is intentional: existing role-specific exceptions act as a basic
allowlist. A bot should **not** pretend this is a total channel freeze when
moderator, trusted-role, or Administrator users may still post.

Yuugen does **not** automatically add roles to an allowlist, change other
roles, or remove existing allow entries. For more complex rules, use the
native Discord role/channel editor or extend issue #54 with a separately
permission-reviewed allowlist management task.

A channel whose permissions are currently *synced to its category* is
refused. Editing its child overwrite would desync it from the category.
Administrators must deliberately desync the channel in Discord first or
apply the desired restrictions at category level outside Yuugen. Even after
unlock, previously unsynced channels are not auto-resynced to a category.

## Authorization and confirmation

Both the moderator and Yuugen need **View Channel**, **Manage Channels**,
and **Manage Roles** in the exact target channel. Discord's endpoint for
editing permission overwrites requires Manage Roles; Manage Channels is a
separate staff safety restriction. The bot fetches the channel, actor and
bot membership before preview and again before confirmation.

Lock/unlock requires a nonempty reason (1–512 characters). The confirmation
expires after **60 seconds** and is bound to its initiating moderator,
guild and interaction message. It is consumed before any asynchronous work,
so double clicks and a canceled/expired button cannot perform multiple
channel changes.

Prompts exist in bot process memory only. A restart invalidates them; the
moderator must run the command again.

## Exact snapshot and restore

On lock, Yuugen reads the complete existing @everyone permission overwrite:
its existence flag, allowed bitfield and denied bitfield. It refuses a
channel where @everyone **Send Messages is already denied** (because that
restriction was not created by Yuugen).

Before editing Discord, the bot creates a persistent lock audit record with
the exact original bitfields and intended locked bitfields:

- If there was no @everyone overwrite, unlocking removes the overwrite
  Yuugen created, after verifying it remains exactly as expected.
- If an overwrite existed, unlocking sets **only Send Messages** to its
  original state (explicit allow or inherited). All other permission bits
  stay unchanged.
- If any part of @everyone overwrite has changed since the lock, unlocking
  **refuses to overwrite external modifications** and tells staff to
  reconcile the channel manually.

Discord does not provide atomic compare-and-swap on channel permission
overwrites. A separate human edit racing between Yuugen's final permission
read and its REST update is still possible. For large or multi-admin
communities, coordinate staff changes and inspect Discord audit logs before
restoring disputed permissions.

## Durable lock records and pending outcomes

The new PostgreSQL table **moderation_channel_locks** stores every lock
attempt with the channel, guild, moderator, reason, original/locked
permission-bit snapshots, state, timestamps and unlock actor/reason.
It does **not** store messages or their contents.

States:

- **lock_pending**: audit written before Discord was asked to deny sending.
  An inconclusive REST result or DB outage leaves this for staff review.
- **locked**: Discord confirmed the lock and the audit was finalized.
- **unlock_pending**: an existing locked row reserved by a moderator before
  sending the Discord unlock request. It remains pending if the response is
  ambiguous, the bot crashed, or DB finalization failed.
- **unlocked**: Discord confirmed restoration and audit finalization.
- **failed**: Discord definitively denied the initial lock attempt.

A verified Discord 403/50013/50001 unlock rejection returns the row to
**locked** and records an error; a clear lock rejection marks the row
**failed**. Generic timeouts or unavailable APIs never trigger an
automatic retry. The database enforces **one active or pending lock per
guild/channel** with a partial unique index, even across multiple bot
processes. Each completed lock remains in history as an independent row.

Use **/mod lockstatus** to see whether the active case is locked or
unresolved, with the original actor and whether the overwrite matches the
saved locked snapshot. To reconcile a pending case:

1. Restrict action to the guild administrator / DB operator.
2. Back up PostgreSQL and inspect the channel's fresh permission overwrite
   and Discord audit log alongside the stored lock row.
3. Determine what Discord actually did; do **not** blindly clear or retry
   a pending case. If an external admin changed the permissions, resolve
   the desired state with them first.
4. Update the audit status through a separately reviewed recovery procedure
   only after the actual state is confirmed. No public reconciliation API
   or automatic unlock job is provided yet.

## Scheduling dependency

**Timed/automatic unlock is not implemented in this PR.** The durable
job-scheduler infrastructure is tracked in issue #90. An in-memory timer
would be unreliable across process restarts, so lock duration is deliberately
not accepted until a persistent, idempotent scheduler exists. Keep the
scheduled-unlock acceptance item in issue #54 open.

## Required PostgreSQL migration

**Before deploying this backend**, back up PostgreSQL and apply the
migrations in this order, skipping already-applied ones as appropriate:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261019_economy_integrity.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261020_moderation_warnings.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261028_moderation_timeouts.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261028_moderation_purges.sql
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261028_moderation_channel_locks.sql
```

The last migration creates a new table and partial unique index. It does
not modify channel permissions, existing moderation cases or XP/economy
balances. Production TypeORM synchronization must remain disabled. The
migration **is not run by merging code**.

## Disposable-guild staging acceptance

Use a network-connected checkout. GitHub Actions are intentionally disabled.

```bash
cd backend
npm ci
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

1. Make a test text channel with unsynced permissions. Give a test moderator
   and bot View Channel / Manage Channels / Manage Roles. Preview /mod lock:
   no permissions change before Confirm.
2. Click Cancel, or allow the prompt to expire. Confirm neither writes a
   lock record nor changes Discord permissions.
3. Confirm a lock. Verify @everyone Send Messages is Deny; existing
   role-specific allows, other overwrite bits and Administrator ability
   to post remain unchanged. Inspect the recorded case and Discord audit.
4. Confirm /mod unlock. Verify it restores the former @everyone
   Send Messages value, and other overwrite bits remain untouched.
5. Repeat where the @everyone overwrite was originally missing, explicitly
   allowed Send Messages, or had unrelated permission bits. Verify proper
   restoration and no extra empty overwrite created in the missing case.
6. Try a category-synced child channel, an already manually locked channel,
   another guild's channel, a non-text channel and unsupported threads.
   They must be refused.
7. Remove Manage Roles/Channels/View Channel from either moderator or bot
   after preview. Confirmation must recheck and deny.
8. Change any @everyone permission bit after lock. Unlock must refuse
   instead of clobbering manual changes.
9. Test two simultaneous lock commands from separate processes. Only one
   DB reservation can exist for that guild/channel; a second guild can lock
   its own channel independently.
10. Test double-click, unauthorized button user, cancel and restart.
    No stale confirmations may be executed.
11. Simulate DB outage before lock/unlock and verify no permissions changed.
12. Simulate explicit Discord permissions rejection and ambiguous network
    failures; inspect failed, locked and pending case states, including
    /mod lockstatus and the recovery instructions above.
13. Verify historical lock/unlock actor, reason and timestamp are retained,
    and that existing warn/kick/ban/timeout/purge commands still work.

**Not production-ready until these checks pass.** Do not test locks on an
active community channel. This PR does not deploy, run migrations, mutate
Discord guilds, or re-enable GitHub Actions.
