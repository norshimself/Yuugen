import { ChannelType, GuildMember } from 'discord.js';
import { SettingsService } from '../../domain/settings/settings.service';
import { formatWelcomeMessage, WelcomeListener } from './welcome.listener';

jest.mock('@napi-rs/canvas', () => ({
  createCanvas: jest.fn(() => { throw new Error('Image unavailable'); }),
  loadImage: jest.fn(),
}));

describe('WelcomeListener', () => {
  const memberId = '123456789012345678';
  const guildId = '234567890123456789';
  const channelId = '345678901234567890';

  it('formats welcome tokens and clamps Discord message length', () => {
    expect(formatWelcomeMessage(
      'Welcome {user} to {guild}! Hi {USER}',
      `<@${memberId}>`,
      'Night Garden',
    )).toBe(`Welcome <@${memberId}> to Night Garden! Hi <@${memberId}>`);
    expect(formatWelcomeMessage('x'.repeat(3000), '', '')).toHaveLength(2000);
  });

  it('does not send to arbitrary channels if no welcome channel is configured', async () => {
    const settings = {
      getSettings: jest.fn().mockResolvedValue({ welcomeChannelId: '' }),
    } as unknown as SettingsService;
    const fetch = jest.fn();
    const member = {
      guild: { id: guildId, channels: { fetch } },
    } as unknown as GuildMember;

    await new WelcomeListener(settings).onGuildMemberAdd(member);
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends the configured text even when image rendering fails, without mass mentions', async () => {
    const send = jest.fn().mockResolvedValue(undefined);
    const settings = {
      getSettings: jest.fn().mockResolvedValue({
        welcomeChannelId: channelId,
        welcomeMessage: 'Hi {user} in {guild} @everyone',
      }),
    } as unknown as SettingsService;
    const member = {
      id: memberId,
      user: { username: 'test', displayAvatarURL: jest.fn() },
      guild: {
        id: guildId,
        name: 'Night Garden',
        memberCount: 3,
        channels: {
          fetch: jest.fn().mockResolvedValue({
            type: ChannelType.GuildText,
            send,
          }),
        },
      },
    } as unknown as GuildMember;

    await new WelcomeListener(settings).onGuildMemberAdd(member);
    expect(send).toHaveBeenCalledWith({
      content: `Hi <@${memberId}> in Night Garden @everyone`,
      allowedMentions: { parse: [], users: [memberId] },
    });
  });
});
