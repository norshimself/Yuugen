# Guild welcomes and moderation

Yuugen now reads saved guild settings when members join and when messages
arrive. **Settings Deck remains disabled in the main navigation pending manual
testing**; the authenticated `/guild-settings?guildId=<Discord guild ID>` page
is available to users with Discord **Manage Server** permission.

## Enable the privileged Discord intents

For features to work, open your app in Discord Developer Portal → Bot and
enable the corresponding **Privileged Gateway Intents**, then set these
backend `.env` flags and restart the backend:

```env
ENABLE_GUILD_MEMBERS_INTENT=true
ENABLE_MESSAGE_CONTENT_INTENT=true
```

- `ENABLE_GUILD_MEMBERS_INTENT=true` requests **Server Members Intent** and
  enables the `guildMemberAdd` welcome listener.
- `ENABLE_MESSAGE_CONTENT_INTENT=true` requests **Message Content Intent**
  so blacklist matching can inspect users' messages.
- Setting an intent flag to true **without enabling it in the Discord portal**
  may cause Discord to reject the bot gateway connection. Both flags default
  to false to avoid breaking existing servers.

Your bot also needs permission to **View Channel** and **Send Messages** in
the configured welcome channel, and **Manage Messages** where moderation
should delete content.

## Settings behavior

- **Welcome channel:** only a configured writable text channel is used.
  An empty channel ID disables welcomes; Yuugen will not fall back to
  `#general` or another channel by name.
- **Welcome message:** supports `{user}` and `{guild}` placeholders.
  Everyone/role pings are disabled; only the joining member may be mentioned.
  Yuugen tries to send an image and falls back to text on image failure.
- **Word blacklist:** active only when `profanityFilterEnabled` is true.
  Stored words and phrases match complete words, case-insensitively
  (including Unicode text), avoiding substring false positives.
  Words containing commas are rejected because the current schema uses
  TypeORM's `simple-array` column type.
- **Anti-spam:** active only when `antiSpamEnabled` is true. Six messages
  from one user in eight seconds or three identical messages in twelve
  seconds will be blocked. The activity state is in-memory, is scoped per
  Discord guild and user, and resets on restart.
- **Message removal:** a blocked message is deleted when the bot has permission.
  Blocked content never earns XP, even if it cannot be deleted.
- **Prefix:** the prefix is stored, but Yuugen currently uses Discord slash
  commands. Configuring a prefix does not create prefix commands.

Guild settings are cached for 30 seconds to avoid a database lookup on every
message; saves update the cache immediately.

## Manual acceptance tests

1. Ensure both privileged intents are enabled in the portal and backend
   environment, restart, and confirm Discord login succeeds.
2. As a guild admin, open `/guild-settings?guildId=...`, select a text
   channel where the bot can send, and save `Welcome {user} to {guild}`.
3. Join with a disposable test account. Verify the greeting appears **only**
   in the configured channel and mentions only the joining member.
4. Clear the channel setting and rejoin; verify no greeting is sent.
5. Enable filtering with a test blocked word; send it from a test account
   and verify deletion without XP being granted. Disable the filter and
   verify the same message is not blocked.
6. Enable anti-spam and send six distinct rapid messages, or three identical
   messages. Verify the threshold and that another user/guild is unaffected.
7. Remove `Manage Messages` permission temporarily and ensure the bot
   doesn't crash on a deletion failure.
8. Check that a non-admin user cannot read or change guild settings.

GitHub Actions are disabled; run local `npm ci`, `npm run build`, and
`npm test -- --runInBand` in `backend/` before manual deployment.
