import type { OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect } from '@nestjs/websockets';
import { WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import type { Server, Socket } from 'socket.io';
import { config } from '../../config';
import { PrismaService } from '../../common/prisma.service';
import { RedisService } from '../../redis/redis.service';
import { resolveWsSession } from '../../auth/ws-session';

/**
 * Socket.IO gateway that fans Redis run-update messages out to subscribed
 * clients. Clients join one room per runId — the run detail page subscribes
 * to a single run, nothing broader.
 *
 * `handleConnection` authenticates the handshake against the same Better
 * Auth session cookie that REST routes use, then asserts the requested
 * `runId` belongs to the session's active organization. Any failure
 * (missing cookie, mismatched org, run not found) results in a single
 * `client.disconnect(true)` with no error payload — defense in depth, no
 * shape difference between "wrong org" and "run does not exist".
 */
@WebSocketGateway({
  namespace: '/runs',
  cors: { origin: config.corsOrigin, credentials: true },
})
export class RunsGateway implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer()
  private server!: Server;

  private unsubscribe: (() => void) | undefined;

  constructor(
    private readonly redis: RedisService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(): void {
    this.unsubscribe = this.redis.onRunUpdate((msg) => {
      this.server.to(`run:${msg.runId}`).emit('node-update', msg);
    });
  }

  async handleConnection(client: Socket): Promise<void> {
    const { runId } = client.handshake.query;
    if (typeof runId !== 'string' || runId.length === 0) {
      client.disconnect(true);
      return;
    }

    const auth = await resolveWsSession(client.handshake.headers);
    if (!auth) {
      client.disconnect(true);
      return;
    }

    const orgId = auth.session.activeOrganizationId;
    if (!orgId) {
      client.disconnect(true);
      return;
    }

    const run = await this.prisma.workflowRun.findFirst({
      where: { id: runId, orgId },
      select: { id: true },
    });
    if (!run) {
      client.disconnect(true);
      return;
    }

    client.join(`run:${runId}`);
  }

  handleDisconnect(client: Socket): void {
    client.removeAllListeners();
  }

  onModuleDestroy(): void {
    this.unsubscribe?.();
  }
}
