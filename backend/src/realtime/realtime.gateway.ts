import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  OnGatewayInit,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import { isUUID } from 'class-validator';
import type { Server, Socket } from 'socket.io';
import type { AccessTokenPayload, AuthUser } from '../auth/auth-user.js';
import { clientScope } from '../common/scope.js';
import { Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { JoinResult, RealtimeCommands, rooms } from './realtime.events.js';
import { RealtimeService } from './realtime.service.js';

interface SocketData {
  user: AuthUser;
  /** Время истечения access-токена, мс (unix) */
  expiresAtMs: number;
  expiryTimer?: NodeJS.Timeout;
}
type AuthedSocket = Socket<
  Record<string, never>,
  Record<string, never>,
  Record<string, never>,
  SocketData
>;

/**
 * Socket.IO шлюз. Подключение требует access JWT (`auth: { token }` или заголовок
 * `Authorization: Bearer …`). После подключения сокет автоматически входит в комнату своего
 * клиента (`client:{id}`) либо, для ADMIN, в `admins`; комнату заявки (`request:{id}`) клиент
 * запрашивает командой `request.join` — с той же проверкой доступа, что и в HTTP.
 * Соединение закрывается, когда истекает использованный токен (клиент переподключается с новым).
 */
@WebSocketGateway()
export class RealtimeGateway
  implements OnGatewayInit, OnGatewayConnection, OnGatewayDisconnect
{
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
    private readonly realtime: RealtimeService,
  ) {}

  afterInit(server: Server) {
    this.realtime.attach(server);
    server.use((socket, next) => {
      this.authenticate(socket as AuthedSocket).then(
        () => next(),
        () => next(new Error('unauthorized')),
      );
    });
  }

  handleConnection(socket: AuthedSocket) {
    const { user, expiresAtMs } = socket.data;
    void socket.join(
      user.role === Role.ADMIN ? rooms.admins : rooms.client(user.clientId!),
    );

    const ttl = Math.max(0, expiresAtMs - Date.now());
    socket.data.expiryTimer = setTimeout(() => socket.disconnect(true), ttl);
    socket.data.expiryTimer.unref();
  }

  handleDisconnect(socket: AuthedSocket) {
    clearTimeout(socket.data.expiryTimer);
  }

  @SubscribeMessage(RealtimeCommands.JOIN_REQUEST)
  async joinRequest(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { requestId?: unknown },
  ): Promise<JoinResult> {
    const requestId = body?.requestId;
    if (typeof requestId !== 'string' || !isUUID(requestId)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }

    const request = await this.prisma.request.findFirst({
      where: { id: requestId, ...clientScope(socket.data.user) },
      select: { id: true },
    });
    // Чужая и несуществующая заявка неотличимы
    if (!request) return { ok: false, error: 'NOT_FOUND' };

    await socket.join(rooms.request(requestId));
    return { ok: true };
  }

  @SubscribeMessage(RealtimeCommands.LEAVE_REQUEST)
  async leaveRequest(
    @ConnectedSocket() socket: AuthedSocket,
    @MessageBody() body: { requestId?: unknown },
  ): Promise<JoinResult> {
    if (typeof body?.requestId !== 'string' || !isUUID(body.requestId)) {
      return { ok: false, error: 'BAD_REQUEST' };
    }
    await socket.leave(rooms.request(body.requestId));
    return { ok: true };
  }

  private async authenticate(socket: AuthedSocket): Promise<void> {
    const auth = socket.handshake.auth as { token?: unknown } | undefined;
    const header = socket.handshake.headers.authorization;
    const token =
      typeof auth?.token === 'string'
        ? auth.token
        : header?.startsWith('Bearer ')
          ? header.slice('Bearer '.length)
          : undefined;
    if (!token) throw new Error('no token');

    const payload = await this.jwt.verifyAsync<
      AccessTokenPayload & { exp: number }
    >(token, { secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET') });
    if (payload.role !== Role.ADMIN && !payload.clientId) {
      this.logger.warn(`User ${payload.sub} has no client; connection refused`);
      throw new Error('no client');
    }

    socket.data.user = {
      id: payload.sub,
      role: payload.role,
      clientId: payload.clientId,
    };
    socket.data.expiresAtMs = payload.exp * 1000;
  }
}
