import { ChannelType } from 'discord.js';
import { WelcomeListener, formatWelcomeMessage } from './welcome.listener';
import { rulesButtonId } from '../../domain/onboarding/onboarding-policy';

jest.mock('@napi-rs/canvas', () => ({
  createCanvas: jest.fn(() => { throw new Error('Image unavailable'); }),
  loadImage: jest.fn(),
}));

describe('Welcome / goodbye / first-time onboarding (#62)', () => {
  const guildId = '123456789012345678';
  const userId = '234567890123456789';
  const welcomeId = '345678901234567890';
  const goodbyeId = '456789012345678901';
  const rulesId = '567890123456789012';

  function setup() {
    const settings = {
      welcomeChannelId: welcomeId,
      welcomeMessage: 'Hi {user} in {guild} @everyone',
      goodbyeChannelId: goodbyeId,
      goodbyeMessage: 'Goodbye {user} from {guild}',
      welcomeDmEnabled: false,
      welcomeDmMessage: 'Welcome to {guild}, {user}!',
      rulesAcknowledgementEnabled: false,
      rulesChannelId: null as string | null,
    };
    const service = { getSettings: jest.fn().mockResolvedValue(settings) };
    const onboarding = {
      reserve: jest.fn().mockResolvedValue(7),
      finish: jest.fn().mockResolvedValue(true),
      acknowledge: jest.fn().mockResolvedValue(true),
    };
    const config = { get: jest.fn().mockReturnValue('true') };
    const send = jest.fn().mockResolvedValue({});
    const dm = jest.fn().mockResolvedValue({});
    const perms = { has: jest.fn().mockReturnValue(true) };
    const channel = {
      type: ChannelType.GuildText,
      permissionsFor: jest.fn().mockReturnValue(perms), send,
    };
    const guild = {
      id: guildId, name: 'Night Garden', memberCount: 4,
      channels: { fetch: jest.fn().mockResolvedValue(channel) },
      members: { me: { id: '678901234567890123' },
        fetchMe: jest.fn(), fetch: jest.fn() },
    };
    const member = {
      id: userId, joinedTimestamp: Date.now(),
      user: { bot: false, username: 'Newcomer', send: dm,
        displayAvatarURL: jest.fn().mockReturnValue('https://example.test/avatar.png') },
      guild,
    };
    guild.members.fetch = jest.fn(async ({ user }: { user: string }) =>
      user === member.id ? member : null);
    const listener = new WelcomeListener(service as any, onboarding as any, config as any);
    return {
      listener, service, onboarding, config, settings,
      send, dm, perms, channel, guild, member,
    };
  }

  it('preserves the existing template API and limits message length', () => {
    expect(formatWelcomeMessage('Hi {user} {USER} in {guild}',
      '<@' + userId + '>', 'Night Garden'))
      .toBe('Hi <@' + userId + '> <@' + userId + '> in Night Garden');
    expect(formatWelcomeMessage('x'.repeat(3000), '', '')).toHaveLength(2000);
  });

  it('does not query the DB or send without Guild Members intent', async () => {
    const x = setup();
    x.config.get.mockReturnValue('false');
    await x.listener.onGuildMemberAdd(x.member as any);
    await x.listener.onGuildMemberRemove(x.member as any);
    expect(x.service.getSettings).not.toHaveBeenCalled();
    expect(x.onboarding.reserve).not.toHaveBeenCalled();
    expect(x.send).not.toHaveBeenCalled();
  });

  it('does not use arbitrary channel fallback when destination is disabled', async () => {
    const x = setup();
    x.settings.welcomeChannelId = '';
    x.settings.goodbyeChannelId = '';
    await x.listener.onGuildMemberAdd(x.member as any);
    await x.listener.onGuildMemberRemove(x.member as any);
    expect(x.guild.channels.fetch).not.toHaveBeenCalled();
    expect(x.onboarding.reserve).not.toHaveBeenCalled();
  });

  it('sends a single text welcome when image preparation fails, with one user mention', async () => {
    const x = setup();
    await x.listener.onGuildMemberAdd(x.member as any);
    expect(x.onboarding.reserve).toHaveBeenCalledWith(
      guildId, userId, 'welcome', String(x.member.joinedTimestamp), expect.any(Number),
    );
    expect(x.send).toHaveBeenCalledTimes(1);
    expect(x.send).toHaveBeenCalledWith({
      content: 'Hi <@' + userId + '> in Night Garden @everyone',
      allowedMentions: { parse: [], users: [userId] },
    });
    expect(x.onboarding.finish).toHaveBeenCalledWith(guildId, 7, 'sent');
  });

  it('does not resend after an ambiguous Discord send error', async () => {
    const x = setup();
    x.send.mockRejectedValueOnce(new Error('network may have delivered it'));
    await x.listener.onGuildMemberAdd(x.member as any);
    expect(x.send).toHaveBeenCalledTimes(1);
    expect(x.onboarding.finish).not.toHaveBeenCalled();
  });

  it('fails closed when the welcome destination loses permission', async () => {
    const x = setup();
    x.perms.has.mockReturnValue(false);
    await x.listener.onGuildMemberAdd(x.member as any);
    expect(x.send).not.toHaveBeenCalled();
    expect(x.onboarding.finish).toHaveBeenCalledWith(
      guildId, 7, 'missing_permissions',
    );
  });

  it('uses the configured goodbye destination with all mentions disabled', async () => {
    const x = setup();
    await x.listener.onGuildMemberRemove(x.member as any);
    expect(x.guild.channels.fetch).toHaveBeenCalledWith(goodbyeId);
    expect(x.onboarding.reserve).toHaveBeenCalledWith(
      guildId, userId, 'goodbye', String(x.member.joinedTimestamp), expect.any(Number),
    );
    expect(x.send).toHaveBeenCalledWith({
      content: 'Goodbye <@' + userId + '> from Night Garden',
      allowedMentions: { parse: [] },
    });
  });

  it('never sends an onboarding DM unless explicitly enabled', async () => {
    const x = setup();
    await x.listener.onGuildMemberAdd(x.member as any);
    expect(x.dm).not.toHaveBeenCalled();
    expect(x.onboarding.reserve.mock.calls.some((c: any[]) => c[2] === 'welcome_dm'))
      .toBe(false);
  });

  it('sends a first-time DM independent of a public welcome destination', async () => {
    const x = setup();
    x.settings.welcomeChannelId = '';
    x.settings.welcomeDmEnabled = true;
    await x.listener.onGuildMemberAdd(x.member as any);
    expect(x.dm).toHaveBeenCalledWith({
      content: 'Welcome to Night Garden, Newcomer!',
      allowedMentions: { parse: [] }, components: [],
    });
    expect(x.onboarding.reserve).toHaveBeenCalledWith(
      guildId, userId, 'welcome_dm', String(x.member.joinedTimestamp), expect.any(Number),
    );
  });

  it('treats DMs-disabled response 50007 as known failure without retry', async () => {
    const x = setup();
    x.settings.welcomeChannelId = '';
    x.settings.welcomeDmEnabled = true;
    x.dm.mockRejectedValueOnce({ code: 50007 });
    await x.listener.onGuildMemberAdd(x.member as any);
    expect(x.dm).toHaveBeenCalledTimes(1);
    expect(x.onboarding.finish).toHaveBeenCalledWith(
      guildId, 7, 'dm_unavailable',
    );
  });

  it('sends a safe rules-link and user-bound acknowledgement button only when selected', async () => {
    const x = setup();
    x.settings.welcomeChannelId = '';
    x.settings.welcomeDmEnabled = true;
    x.settings.rulesAcknowledgementEnabled = true;
    x.settings.rulesChannelId = rulesId;
    await x.listener.onGuildMemberAdd(x.member as any);
    const options = x.dm.mock.calls[0][0];
    const row = options.components[0].toJSON();
    expect(row.components).toHaveLength(2);
    expect(row.components[0].url).toBe(
      'https://discord.com/channels/' + guildId + '/' + rulesId,
    );
    expect(row.components[1].custom_id).toBe(
      rulesButtonId(guildId, String(x.member.joinedTimestamp)),
    );
    expect(options.allowedMentions).toEqual({ parse: [] });
  });

  it('does not DM an unusable rules link to an inaccessible channel', async () => {
    const x = setup();
    x.settings.welcomeChannelId = '';
    x.settings.welcomeDmEnabled = true;
    x.settings.rulesAcknowledgementEnabled = true;
    x.settings.rulesChannelId = rulesId;
    x.guild.channels.fetch.mockResolvedValueOnce(null);
    await x.listener.onGuildMemberAdd(x.member as any);
    expect(x.dm).not.toHaveBeenCalled();
    expect(x.onboarding.finish).toHaveBeenCalledWith(
      guildId, 7, 'missing_permissions',
    );
  });

  it('records the rules acknowledgement from the authenticated current member only', async () => {
    const x = setup();
    x.settings.welcomeDmEnabled = true;
    x.settings.rulesAcknowledgementEnabled = true;
    const interaction = {
      isButton: () => true,
      customId: rulesButtonId(guildId, String(x.member.joinedTimestamp)),
      guildId: null,
      client: { guilds: { cache: new Map([[guildId, x.guild]]) } },
      user: { id: userId },
      reply: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      replied: false, deferred: false,
    };
    await x.listener.onInteraction(interaction as any);
    expect(x.guild.members.fetch).toHaveBeenCalledWith({ user: userId, force: true });
    expect(x.onboarding.acknowledge).toHaveBeenCalledWith(
      guildId, userId, String(x.member.joinedTimestamp),
    );
    expect(interaction.update).toHaveBeenCalledWith({
      content: 'Rules acknowledgement recorded. Thank you!',
      components: [], allowedMentions: { parse: [] },
    });
    expect(interaction.reply).not.toHaveBeenCalled();
  });

  it('refuses an acknowledgement from a different user or expired session', async () => {
    const x = setup();
    x.settings.welcomeDmEnabled = true;
    x.settings.rulesAcknowledgementEnabled = true;
    const interaction = {
      isButton: () => true,
      customId: rulesButtonId(guildId, String(x.member.joinedTimestamp)),
      guildId: null,
      client: { guilds: { cache: new Map([[guildId, x.guild]]) } },
      user: { id: '987654321098765432' },
      reply: jest.fn().mockResolvedValue({}),
      update: jest.fn().mockResolvedValue({}),
      replied: false, deferred: false,
    };
    await x.listener.onInteraction(interaction as any);
    expect(x.onboarding.acknowledge).not.toHaveBeenCalled();
    expect(interaction.update).not.toHaveBeenCalled();
    expect(interaction.reply).toHaveBeenCalled();

    x.member.joinedTimestamp = Date.now() - 8 * 24 * 3600000;
    interaction.user.id = userId;
    interaction.customId = rulesButtonId(guildId, String(x.member.joinedTimestamp));
    await x.listener.onInteraction(interaction as any);
    expect(x.onboarding.acknowledge).not.toHaveBeenCalled();
  });
});
