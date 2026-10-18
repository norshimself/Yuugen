import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { JwtService } from '@nestjs/jwt';
import { Client } from 'discord.js';
import { Server, WebSocket } from 'ws';

interface GuildSubscription {
  guildId: string;
  expiresAt: number;
}

@WebSocketGateway({ path: '/api/v1/player/ws' })
export class PlayerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // No player data is sent before a valid, guild-authorized subscription.
  private readonly activeClients = new Map<WebSocket, GuildSubscription>();

  constructor(
    private readonly jwtService: JwtService,
    private readonly discordClient: Client,
  ) {}

  handleConnection(_client: WebSocket) {
    // Client must authenticate through subscribeGuild first.
  }

  handleDisconnect(client: WebSocket) {
    this.activeClients.delete(client);
  }

  @SubscribeMessage('subscribeGuild')
  async handleSubscribeGuild(
    @ConnectedSocket() client: WebSocket,
    @MessageBody() data: unknown,
  ) {
    // Re-subscription must never preserve an older authorization.
    this.activeClients.delete(client);

    let payload: Record<string, unknown>;
    try {
      const value: unknown = typeof data === 'string' ? JSON.parse(data) : data;
      if (!value || typeof value !== 'object' || Array.isArray(value)) {
        return this.reject(client, 'invalid_request');
      }
      payload = value as Record<string, unknown>;
    } catch {
      return this.reject(client, 'invalid_request');
    }

    const guildId = payload.guildId;
    const token = payload.token;
    if (
      typeof guildId !== 'string' ||
      !/^\d{17,20}$/.test(guildId) ||
      typeof token !== 'string' ||
      !token
    ) {
      return this.reject(client, 'invalid_request');
    }

    let claims: { userId?: string; exp?: number };
    try {
      claims = await this.jwtService.verifyAsync<{
        userId?: string;
        exp?: number;
      }>(token);
    } catch {
      return this.reject(client, 'invalid_token');
    }

    if (
      typeof claims.userId !== 'string' ||
      !/^\d{17,20}$/.test(claims.userId) ||
      typeof claims.exp !== 'number' ||
      claims.exp * 1000 <= Date.now()
    ) {
      return this.reject(client, 'invalid_token');
    }

    const guild = this.discordClient.guilds.cache.get(guildId);
    if (!guild) {
      return this.reject(client, 'forbidden');
    }
    const member = await guild.members
      .fetch({ user: claims.userId, force: true })
      .catch(() => null);
    if (!member) {
      return this.reject(client, 'forbidden');
    }

    if (client.readyState !== WebSocket.OPEN) return;
    this.activeClients.set(client, {
      guildId,
      expiresAt: claims.exp * 1000,
    });
    client.send(JSON.stringify({ event: 'subscribed', guildId }));
  }

  private reject(
    client: WebSocket,
    code: 'invalid_request' | 'invalid_token' | 'forbidden',
  ) {
    if (client.readyState === WebSocket.OPEN) {
      client.send(JSON.stringify({ event: 'subscriptionError', code }));
    }
  }

  broadcastPlayerState(guildId: string, payload: unknown) {
    const message = JSON.stringify({
      event: 'playerUpdate',
      guildId,
      data: payload,
    });
    for (const [client, subscription] of this.activeClients.entries()) {
      if (
        client.readyState !== WebSocket.OPEN ||
        subscription.expiresAt <= Date.now()
      ) {
        this.activeClients.delete(client);
        if (client.readyState === WebSocket.OPEN) {
          client.close(1008, 'Session expired');
        }
        continue;
      }
      if (subscription.guildId === guildId) {
        client.send(message);
      }
    }
  }
}
