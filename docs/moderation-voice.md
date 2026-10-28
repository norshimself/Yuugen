# Voice moderation: /mod voice (issue #55)

Yuugen adds individual-member voice moderation using a nested Discord slash
command group. **This code is not deployed or staging-verified.**

## Discord commands

| Command | Required moderator/bot voice permission | Effect |
| --- | --- | --- |
| /mod voice mute user reason | Mute Members in source | Set server mute |
| /mod voice unmute user reason | Mute Members in source | Clear server mute |
| /mod voice deafen user reason | Deafen Members in source | Set server deafen |
| /mod voice undeafen user reason | Deafen Members in source | Clear server deafen |
| /mod voice disconnect user source reason | Move Members in source | Disconnect one member |
| /mod voice move user source destination reason | Move Members in both, Connect in destination | Move one member |
| /mod voice history user / user_id | View Audit Log in guild | Show up to 10 recent cases |

The source and destination of a move **must both be explicitly supplied**
and be distinct normal voice channels in the current guild. For disconnect,
the source must be explicitly specified too. Stage channels, mass movement,
voice-channel creation and automatic voice restoration are not supported.

Use server mute/deafen only: members' own self-mute/self-deafen preferences
are never changed. No new privileged intents are required, because Yuugen
already uses the standard GuildVoiceStates gateway intent.

## Authorization and safety

Both the moderator and Yuugen are checked for the action-specific permission
in the *actual source voice channel*, including View Channel. For moves,
both also need Move Members in the destination plus **Connect** there.
Checking only guild-wide permissions would miss channel overwrites.

Before a prompt, before accepting confirmation and **after reserving an
audit case**, the bot fetches the moderator, target and bot member, the
current voice state, and relevant channels with fresh Discord requests.
It refuses changes if the target is disconnected, moved to a different
source since preview, is the server owner, is the moderator themselves,
is a bot, has Administrator, or is higher/equal in the moderator's or
bot's role hierarchy (guild-owner moderators bypass only their own role
comparison). It also refuses a repeat server mute/deafen or removal of
a state that is not currently active.

All actions require a nonempty 1–512 character audit reason. The bot
displays a **private 60-second Confirm/Cancel prompt** bound to the exact
moderator, guild, action and message. A prompt is consumed synchronously
before any await, preventing double clicks. Prompts are in process memory
and expire on bot restart. Responses disable mentions. Each command
affects **exactly one member**.

## Database audit and recovery

The new `moderation_voice_cases` table stores:

- guild, moderator, target Discord user, action
- exact source and optional destination voice channel IDs
- reason, created/completed timestamps, status and error indicator

It stores neither voice audio nor message contents. Case statuses:

- `pending`: written before Discord is contacted; also used for unknown
  outcomes (network timeout/crash or finalization failure)
- `completed`: Discord confirmed the modification and case was finalized
- `failed`: Discord explicitly rejected the API call, or the target changed
  state during the final revalidation before the API operation

A partial unique index permits **one pending action per guild/target**
across multiple bot processes. Two requests cannot race the same member
while an audit case is outstanding. When a case is pending after an
uncertain result, other voice operations for that member deliberately
remain blocked until an administrator reviews what really happened.
Do not clear a pending case blindly or automatically retry a voice change.

To reconcile: back up the audit DB, inspect the stored action and channel
IDs, check the real current Discord voice state and Discord audit logs,
then use a separately reviewed operator procedure to classify the case.
No public pending-case override is provided. A departed voice member
can make current-state verification inconclusive—retain the audit log.

The separate `/mod voice history` command requires **View Audit Log**.
A user ID may be supplied when the member has left the guild; results
remain strictly scoped to the current guild.

## Required migration before deployment

After a PostgreSQL backup and only after previous migrations have been
applied, execute:

```bash
psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
  -f backend/migrations/20261028_moderation_voice.sql
```

This adds a table and indexes; it does not mutate any existing moderation
case, balance or Discord channel. Production TypeORM synchronization must
stay disabled. The full migration order is maintained in
`docs/release-readiness.md`. Merge/PR creation does not run the migration.

## Manual staging acceptance

Run these commands in a network-connected checkout:

```bash
cd backend
npm ci
npm run build
npm test -- --runInBand
npm run test:e2e -- --runInBand
```

Use a **disposable guild and consenting test accounts** with two normal
voice channels, a moderator role above the test member and a bot role
above the test member. Do not use real community members.

1. Ensure `/mod voice mute` previews without changing Discord; Cancel
   and expiry must leave the member untouched.
2. Confirm mute, then unmute. Check the server mute state, not self-mute.
   Repeat with deafen and undeafen, including already-active/inactive states.
3. Remove Mute Members, Deafen Members or Move Members from the acting
   moderator in the source voice channel and confirm each corresponding
   action is denied. Repeat for the bot.
4. Verify the bot and actor need **Move Members** in both source and
   destination and **Connect** in destination for a move.
5. Disconnect one test member from a specified source. Verify another
   member in the same channel is not affected.
6. Move one test member between explicitly named source/destination channels.
   Reject missing source, same source/destination, other-guild, stage,
   text or unavailable channels.
7. Move the member manually between preview and confirmation. The pending
   action must refuse to act. Simulate movement while the case DB INSERT
   is in flight; verify the final revalidation cancels and records failure.
8. Test an equal/higher-role user, bot, server owner, Administrator and
   self-target. Verify every protected action is refused.
9. Revoke the moderator's or bot's permissions after preview. Confirmation
   must re-fetch permissions and refuse.
10. Confirm a valid action: audit record is created **before** the Discord
    mutation and finalized after success. Verify moderator, target, both
    channel IDs (for move), reason and outcome.
11. Test a DB outage before audit insertion (no Discord modification),
    explicit Discord 403 rejection (case failed), network timeout (pending),
    and finalization DB outage (pending for manual reconciliation).
12. Test two concurrent actions for the same guild/member across two
    bot processes. Only one pending audit reservation may exist.
13. Test another user clicking Confirm, a wrong-guild interaction,
    rapid repeated clicks, cancel and expiration. No second action.
14. Run `/mod voice history` with and without View Audit Log and with
    another guild's member ID. History must never cross guild boundaries.
15. Restart the bot: pending confirmation controls must be invalidated,
    but audit history and unresolved pending cases remain in PostgreSQL.
16. Confirm existing /mod warn, kick, ban, timeout, purge and channel lock
    handlers are registered and function as before.

### Operational limits

Discord API state changes are not transactional with PostgreSQL. Two admins
can still manually move a member between the final fetch and REST mutation;
the bot cannot promise to prevent every race without Discord CAS semantics.
The fail-closed checks and audit preserve evidence for manual recovery.

GitHub Actions remain disabled by request. This issue must stay open
until staging sign-off; **no deployment, schema application or real
Discord member change is authorized by this PR**.
