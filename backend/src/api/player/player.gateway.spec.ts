import { JwtService } from '@nestjs/jwt';
import { Client } from 'discord.js';
import { WebSocket } from 'ws';
import { PlayerGateway } from './player.gateway';

describe('PlayerGateway subscriptions', () => {
  const userId = '123456789012345678';
  const guildId = '234567890123456789';

  function setup(jwtValid = true, memberExists = true) {
    const discord = {
      guilds: {
        cache: new Map([
          [guildId, {
            members: {
              fetch: jest.fn().mockResolvedValue(memberExists ? { id: userId } : null),
            },
          }],
        ]),
      },
    } as unknown as Client;
    const jwt = {
      verifyAsync: jwtValid
        ? jest.fn().mockResolvedValue({
          userId,
          exp: Math.floor(Date.now() / 1000) + 900,
        })
        : jest.fn().mockRejectedValue(new Error('Invalid token')),
    } as unknown as JwtService;
    const socket = {
      readyState: WebSocket.OPEN,
      send: jest.fn(),
      close: jest.fn(),
    } as unknown as WebSocket;

    return { gateway: new PlayerGateway(jwt, discord), socket };
  }

  it('denies subscriptions with invalid credentials', async () => {
    const { gateway, socket } = setup(false);
    await gateway.handleSubscribeGuild(socket, { guildId, token: 'invalid' });
    gateway.broadcastPlayerState(guildId, { playing: true });
    const messages = (socket.send as jest.Mock).mock.calls.map(([text]) =>
      JSON.parse(text as string));
    expect(messages).toEqual([{ event: 'subscriptionError', code: 'invalid_token' }]);
  });

  it('does not reveal another guild player state without membership', async () => {
    const { gateway, socket } = setup(true, false);
    await gateway.handleSubscribeGuild(socket, { guildId, token: 'signed' });
    gateway.broadcastPlayerState(guildId, { playing: true });
    const messages = (socket.send as jest.Mock).mock.calls.map(([text]) =>
      JSON.parse(text as string));
    expect(messages).toEqual([{ event: 'subscriptionError', code: 'forbidden' }]);
  });

  it('only broadcasts to an authenticated guild subscriber', async () => {
    const { gateway, socket } = setup();
    gateway.broadcastPlayerState(guildId, { playing: false });
    expect(socket.send).not.toHaveBeenCalled();

    await gateway.handleSubscribeGuild(socket, { guildId, token: 'signed' });
    gateway.broadcastPlayerState(guildId, { playing: true });
    const messages = (socket.send as jest.Mock).mock.calls.map(([text]) =>
      JSON.parse(text as string));
    expect(messages[0]).toEqual({ event: 'subscribed', guildId });
    expect(messages[1]).toEqual({
      event: 'playerUpdate',
      guildId,
      data: { playing: true },
    });
  });
});
