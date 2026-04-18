import type { OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { config } from '../../config.js';
import { RedisService } from '../../redis/redis.service.js';

/**
 * Socket.IO gateway that fans Redis run-update messages out to subscribed
 * clients. Clients join one room per runId — the run detail page subscribes
 * to a single run, nothing broader.
 */
@WebSocketGateway({
  namespace: '/runs',
  cors: { origin: config.corsOrigin, credentials: true },
})
export class RunsGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  @WebSocketServer()
  private server!: Server;

  private unsubscribe: (() => void) | undefined;

  constructor(private readonly redis: RedisService) {}

  afterInit(): void {
    this.unsubscribe = this.redis.onRunUpdate((msg) => {
      this.server.to(`run:${msg.runId}`).emit('node-update', msg);
    });
  }

  handleConnection(client: Socket): void {
    const { runId } = client.handshake.query;
    if (typeof runId === 'string' && runId.length > 0) {
      client.join(`run:${runId}`);
    }
  }

  handleDisconnect(client: Socket): void {
    client.removeAllListeners();
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
