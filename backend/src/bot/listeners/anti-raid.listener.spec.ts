import { ConfigService } from '@nestjs/config';
import { AntiRaidService } from '../../domain/security/anti-raid.service';
import { AntiRaidListener } from './anti-raid.listener';

describe('AntiRaidListener operational safety', () => {
  function setup() {
    const antiRaid = {
      observeJoin: jest.fn().mockResolvedValue({
        guildId: '123456789012345678', alertId: 5,
        alertChannelId: '345678901234567890', joinCount: 12,
        windowSeconds: 60, minAccountAgeMinutes: 1440,
      }),
      finishAlert: jest.fn().mockResolvedValue(true),
    };
    const config = { get: jest.fn().mockReturnValue('true') };
    const send = jest.fn().mockResolvedValue({});
    const permissionsFor = jest.fn().mockReturnValue({ has: jest.fn().mockReturnValue(true) });
    const channel = { type: 0, permissionsFor, send };
    const member = {
      id: '234567890123456789',
      user: { bot: false, createdTimestamp: Date.now() - 3600000 },
      joinedTimestamp: Date.now(),
      roles: { cache: new Map() },
      guild: {
        id: '123456789012345678',
        channels: { fetch: jest.fn().mockResolvedValue(channel) },
        members: { me: { id: '456789012345678901' }, fetchMe: jest.fn() },
      },
    };
    return {
      antiRaid, config, member, channel, permissionsFor, send,
      listener: new AntiRaidListener(
        antiRaid as unknown as AntiRaidService,
        config as unknown as ConfigService,
      ),
    };
  }

  it('never observes members without privileged intent', async () => {
    const { listener, member, config, antiRaid } = setup();
    config.get.mockReturnValue('false');
    await listener.onJoin(member as any);
    expect(antiRaid.observeJoin).not.toHaveBeenCalled();
  });

  it('ignores bots and members without a verified join timestamp', async () => {
    const { listener, member, antiRaid } = setup();
    member.user.bot = true;
    await listener.onJoin(member as any);
    member.user.bot = false;
    member.joinedTimestamp = 0;
    await listener.onJoin(member as any);
    expect(antiRaid.observeJoin).not.toHaveBeenCalled();
  });

  it('sends a single no-mention alert with aggregate context only', async () => {
    const { listener, member, send, antiRaid } = setup();
    await listener.onJoin(member as any);
    expect(antiRaid.observeJoin).toHaveBeenCalledWith(expect.objectContaining({
      guildId: member.guild.id, userId: member.id,
      roleIds: [],
    }));
    expect(send).toHaveBeenCalledWith({
      content: expect.stringContaining('12 eligible member joins'),
      allowedMentions: { parse: [] },
    });
    expect(antiRaid.finishAlert).toHaveBeenCalledWith(
      member.guild.id, 5, 'sent',
    );
  });

  it('never sends without the bot channel permissions and audits known failure', async () => {
    const { listener, member, permissionsFor, send, antiRaid } = setup();
    permissionsFor.mockReturnValue({ has: jest.fn().mockReturnValue(false) });
    await listener.onJoin(member as any);
    expect(send).not.toHaveBeenCalled();
    expect(antiRaid.finishAlert).toHaveBeenCalledWith(
      member.guild.id, 5, 'missing_permissions',
    );
  });

  it('keeps uncertain network outcomes pending instead of claiming failure', async () => {
    const { listener, member, send, antiRaid } = setup();
    send.mockRejectedValueOnce(new Error('network response unavailable'));
    await listener.onJoin(member as any);
    expect(antiRaid.finishAlert).not.toHaveBeenCalled();
  });

  it('does not fetch channels or take action for nonqualifying joins', async () => {
    const { listener, member, antiRaid } = setup();
    antiRaid.observeJoin.mockResolvedValueOnce(null);
    await listener.onJoin(member as any);
    expect(member.guild.channels.fetch).not.toHaveBeenCalled();
    expect(antiRaid.finishAlert).not.toHaveBeenCalled();
  });
});
