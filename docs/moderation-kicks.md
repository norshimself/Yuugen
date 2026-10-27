# Yuugen moderation: confirmed kicks (feature 2)

This builds on the guild-scoped moderation cases introduced in feature 1.

## Commands

- `/mod kick user:<member> reason:<text>` — preview a removal and show
  **Confirm kick** and **Cancel** buttons in a private message.
- `/mod cases user:<user>` — show the 10 most recent warnings, kicks, failed
  attempts and unresolved kick attempts for that member in the current guild.

The original `/mod warn`, `/mod warnings` and `/mod unwarn` commands are
unchanged. Kick records cannot be revoked using `/mod unwarn`.

## Safety controls

- The acting moderator needs the server's **Kick Members** permission.
- Yuugen also needs **Kick Members** and must outrank the target member.
- The server owner, bots, the actor themselves, and members who have left
  cannot be kicked through this command.
- A non-owner moderator's highest role must outrank the target's highest role.
  Guild owners bypass the *actor* hierarchy check, but never the bot's
  permissions or role hierarchy.
- The confirmation expires after 60 seconds and only the original moderator
  can use it. Cancel clears it. Double clicks cannot run two kicks.
- Permissions, hierarchy, and membership are fetched again **after**
  confirmation. Previewing a kick does not remove the member.
- The confirmation lives only in the bot's memory. If the bot restarts,
  the buttons safely become invalid; the moderator must issue a new command.
- Replies are ephemeral and suppress unexpected Discord mentions.

## Durable moderation cases

A kick is an external Discord action, so a database write and an API call
cannot be one transaction. Yuugen uses three stages:

1. **`kick_pending`** — stored in PostgreSQL *before* requesting the
   kick; if the database write fails, no kick is attempted.
2. **`kick`** — the Discord kick call succeeded; update the same case.
3. **`kick_failed`** — Discord explicitly rejected the request with a
   known 403 or 404 response.

If Discord times out or the connection drops, the result may be uncertain.
Yuugen leaves the case **`kick_pending`** instead of claiming that the user
was or was not removed. If the kick succeeds but writing the final status
fails, the same pending record remains. An administrator should reconcile
these by checking guild membership and Discord audit logs **before retrying**.
The bot never automatically retries an ambiguous kick.

All case records are guild-scoped. Case history is available to staff with
Moderate Members permission. Successful and failed attempts retain their
actor, target, reason and timestamp, as with warning cases.

## Database / deployment

No new schema is required: the `moderation_cases.action` varchar column
already supports the new action states. However, the existing migration
**must** be applied before deploying this feature:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f backend/migrations/20261020_moderation_warnings.sql
```

Back up PostgreSQL first. If the previous feature was never deployed,
apply both economy and moderation migrations in order. Do not enable
TypeORM schema auto-sync in production.

GitHub Actions remain intentionally removed. Before deployment, run:

```bash
cd backend
npm ci
npm run build
npm test -- --runInBand
```

## Manual acceptance testing — disposable staging guild only

1. Grant **Kick Members** to a test moderator and the bot. Confirm the bot's
   highest role is above the disposable target member's highest role.
2. Execute `/mod kick`. Verify the target remains in the guild until
   **Confirm kick** is clicked.
3. Click **Cancel**. Verify no case is created and no member is removed.
4. Confirm a kick. Verify the target leaves and `/mod cases` shows `kick`,
   with correct guild, actor, target, time and reason.
5. Test a moderator without Kick Members, an equal/higher role, self,
   server owner, and bot target. Every attempted action must fail.
6. Remove Kick Members from the moderator (or bot) while the confirmation
   is open. Confirm; permission checks must stop the action.
7. Try a confirmation from another account, another guild, or after 60
   seconds. It must not remove anyone.
8. Double-click Confirm; only one case and one Discord kick may occur.
9. Simulate an unavailable database before confirmation; no kick is allowed.
10. Test a Discord 403 permission rejection; `/mod cases` shows
    `kick_failed`. Test a network timeout; the case stays
    `kick_pending` and requires manual review.
11. Verify other guild moderators cannot see or modify this guild's cases.
12. Restart the bot and verify persisted audit history is still available.

**No production kick should be tested on a live member.** A valid
confirmation is an actual removal action; it is not a dry run.
