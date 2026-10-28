# Yuugen moderation: permanent bans (issue #49)

This is the next incremental moderation feature after warning cases (PR #21)
and confirmed kicks (PR #22).

## Discord commands

- `/mod ban user:<current member> reason:<text>` — preview a permanent ban
  and confirm or cancel it using a private Discord button.
- `/mod cases user:<member>` or `/mod cases user_id:<Discord ID>` —
  review warning, kick and ban cases belonging to the current guild, including
  failed and unresolved attempts.

The command **only bans current server members** in this first iteration.
Preemptive bans by raw ID, unbans, temporary bans and mass bans are separate
backlog issues (#50 and #51 for unban/tempban). This command does not delete
a member's old messages: it explicitly uses `deleteMessageSeconds: 0`.

## Authorization and confirmation

- Both the acting moderator and Yuugen need Discord **Ban Members**.
- The target cannot be the server owner, the moderator themselves, or a bot.
- Non-owner moderators must outrank the target's highest role. Yuugen must
  also outrank the target; this is checked through Discord.js `bannable`.
- The target must still be a guild member. The bot fetches current guild
  membership and checks permissions at both preview and confirmation.
- The confirmation is private (ephemeral), valid for **60 seconds**, bound
  to one moderator, one message and one guild. Cancel or a successful
  confirmation consumes it. Two clicks cannot produce two bans.
- Pending confirmations exist in process memory, not in PostgreSQL. After
  restarting Yuugen, they are invalid; moderators must submit a new command.
- Preview and confirmation replies suppress unexpected Discord mentions.
- Viewing cases requires **Moderate Members**, **Kick Members**, or
  **Ban Members**. Issuing warnings, kick and ban actions still requires the
  individual action's specific permission.

## Persistent case lifecycle

The existing `moderation_cases` entity stores a per-guild audit trail.

1. `ban_pending` — persisted **before** contacting Discord. If the database
   write fails, Yuugen does **not** call Discord to ban the member.
2. `ban` — Discord's ban API returned success and the case update completed.
3. `ban_failed` — Discord returned an explicit 403 or 404 rejection.
4. `ban_pending` also represents **uncertain outcomes**: a connection
   timeout or failed post-ban database update cannot prove whether Discord
   accepted the ban. Yuugen does not automatically retry uncertain actions.

For uncertain outcomes, an administrator should check **Discord's guild ban
list** and audit log, not only the current member list. A member absent from
the guild might have left independently. Reconcile the pending case before
trying again; the bot deliberately has no automatic reconciliation action yet.

## Database and deployment requirements

**No new SQL migration** is required: the existing
`moderation_cases.action` varchar(24) already supports `ban_pending`,
`ban` and `ban_failed`.

The migration added with the warning module must exist on the target
database **before** deploying any moderation code:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261020_moderation_warnings.sql
```

Take a PostgreSQL backup first; if the economy migration has not been
applied, run migrations in the documented order. Do not enable schema
synchronization in production. This PR does not migrate or deploy anything.

### Manual verification

```bash
cd backend
npm ci
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Run the following tests in a **disposable staging guild** with an authorized
test moderator, a test target, and a bot whose highest role is above the
target's roles.

1. Preview a ban; the member must remain until Confirm is clicked.
2. Cancel; no case is created and no Discord ban occurs.
3. Confirm; target disappears and appears on the guild ban list, with the
   expected audit reason and **no bulk deletion** of previous messages.
4. Verify `/mod cases user_id:<id>` shows the action as `ban` even after
   the user leaves the guild.
5. Revoke the moderator's Ban Members permission during the preview; the
   subsequent confirmation must be denied.
6. Revoke the bot's Ban Members permission or move its role below the target;
   the action must be denied.
7. Test self, owner, bot, equal/higher-ranked target, departed member and
   invalid/empty/overlong reasons; each must be rejected.
8. Test another user, another guild, 60-second expiry and rapid double
   click; none may create a second ban.
9. Simulate an unavailable database; no ban may be attempted.
10. Test Discord 403/404 rejection: case becomes `ban_failed`.
11. Test network timeout or DB finalization error: case stays
    `ban_pending`, and the response asks staff to investigate.
12. Confirm a moderator with Ban Members (but not Moderate Members) can
    view guild-specific case history, but not another guild's.
13. Verify existing `/mod warn`, `/mod kick` and
    `/mod unwarn` still behave as expected.

GitHub Actions remain disabled due to the user's usage limit. Never run
these tests against an active community member.
