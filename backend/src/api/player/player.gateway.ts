import {
  WebSocketGateway,
  WebSocketServer,
  SubscribeMessage,
  OnGatewayConnection,
  OnGatewayDisconnect,
  MessageBody,
  ConnectedSocket,
} from '@nestjs/websockets';
import { Server } from 'ws';
import { IncomingMessage } from 'http';

@WebSocketGateway({
  path: '/api/v1/player/ws',
})
export class PlayerGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  server: Server;

  // Active socket clients mapped to their subscribed Discord guildId
  private activeClients = new Map<any, string>();

  handleConnection(client: any, request: IncomingMessage) {
    console.log('Client connected to native player WebSocket');
  }

  handleDisconnect(client: any) {
    this.activeClients.delete(client);
    console.log('Client disconnected from native player WebSocket');
  }

  @SubscribeMessage('subscribeGuild')
  handleSubscribeGuild(
    @ConnectedSocket() client: any,
    @MessageBody() data: any,
  ) {
    const payload = typeof data === 'string' ? JSON.parse(data) : data;
    if (payload && payload.guildId) {
      this.activeClients.set(client, payload.guildId);
      console.log(
        `WebSocket client subscribed to guild updates: ${payload.guildId}`,
      );
      client.send(
        JSON.stringify({ event: 'subscribed', guildId: payload.guildId }),
      );
    }
  }

  // Broadcast player changes to all clients viewing the active guild
  broadcastPlayerState(guildId: string, payload: any) {
    const message = JSON.stringify({
      event: 'playerUpdate',
      guildId,
      data: payload,
    });
    for (const [client, clientGuildId] of this.activeClients.entries()) {
      if (clientGuildId === guildId && client.readyState === 1) {
        // 1 = WebSocket.OPEN
        client.send(message);
      }
    }
  }
}
