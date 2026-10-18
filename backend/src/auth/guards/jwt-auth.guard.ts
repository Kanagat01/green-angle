import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { PrismaService } from '../../prisma/prisma.service.js';
import { AccessTokenPayload, AuthUser } from '../auth-user.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

interface RequestWithUser {
  headers: { authorization?: string };
  user?: AuthUser;
}

/**
 * Глобальный guard: требует валидный access-токен везде, кроме маршрутов с @Public().
 * Роль и клиент берутся из БД, а не из токена, и пользователь должен быть активен —
 * поэтому деактивация и смена привязки к клиенту действуют сразу, а не после истечения токена.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    // WebSocket-сокет аутентифицируется один раз при подключении (RealtimeGateway)
    if (context.getType() !== 'http') return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    let payload: AccessTokenPayload;
    try {
      payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
    } catch {
      throw new UnauthorizedException();
    }

    const user = await this.prisma.user.findUnique({
      where: { id: payload.sub },
      select: { id: true, role: true, clientId: true, isActive: true },
    });
    if (!user?.isActive) throw new UnauthorizedException();

    request.user = { id: user.id, role: user.role, clientId: user.clientId };
    return true;
  }
}
