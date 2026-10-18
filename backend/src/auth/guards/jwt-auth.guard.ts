import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import { AccessTokenPayload, AuthUser } from '../auth-user.js';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator.js';

interface RequestWithUser {
  headers: { authorization?: string };
  user?: AuthUser;
}

/**
 * Глобальный guard: требует валидный access-токен везде, кроме маршрутов с @Public().
 * Состояние пользователя (isActive) проверяется при refresh, поэтому деактивация
 * вступает в силу не позже, чем через время жизни access-токена.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly jwt: JwtService,
    private readonly config: ConfigService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<RequestWithUser>();
    const [scheme, token] = request.headers.authorization?.split(' ') ?? [];
    if (scheme !== 'Bearer' || !token) throw new UnauthorizedException();

    try {
      const payload = await this.jwt.verifyAsync<AccessTokenPayload>(token, {
        secret: this.config.getOrThrow<string>('JWT_ACCESS_SECRET'),
      });
      request.user = {
        id: payload.sub,
        role: payload.role,
        clientId: payload.clientId,
      };
    } catch {
      throw new UnauthorizedException();
    }
    return true;
  }
}
