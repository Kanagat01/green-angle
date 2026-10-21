import { ExecutionContext, Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerModule, ThrottlerStorageService } from '@nestjs/throttler';
import { RedisService } from '../redis/redis.service.js';
import { AppThrottlerGuard } from './app-throttler.guard.js';
import { RedisThrottlerStorage } from './redis-throttler-storage.js';

interface HttpRequest {
  method: string;
  url: string;
  ip: string;
  body?: { email?: unknown };
}

/**
 * Запросы с логином/почтой в теле: вход, регистрация и повторное письмо ограничены одними и теми
 * же значениями; счётчики у каждого маршрута свои (так устроен throttler).
 */
const CREDENTIAL_PATHS = new Set([
  '/api/v1/auth/login',
  '/api/v1/auth/register',
  '/api/v1/auth/resend-verification',
]);

const isLoginRequest = (context: ExecutionContext) => {
  const req = context.switchToHttp().getRequest<HttpRequest>();
  return req.method === 'POST' && CREDENTIAL_PATHS.has(req.url.split('?')[0]);
};

/** Ключ для лимита по аккаунту: IP + email из тела (без учёта регистра). */
const ipAndEmail = (req: Record<string, any>) => {
  const { ip, body } = req as HttpRequest;
  const email =
    typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';
  return `${ip}|${email.slice(0, 254)}`;
};

/**
 * Три лимитера. Счётчики общие для всех экземпляров API, если задан REDIS_URL (при недоступном
 * Redis временно считаем в памяти процесса), иначе — только в памяти процесса:
 * - default — общий потолок запросов с одного IP;
 * - login-account — попытки входа по связке IP + email (перебор пароля);
 * - login-ip — попытки входа с одного IP (перебор логинов).
 * Лимит привязан к IP, поэтому чужие неудачные попытки не блокируют настоящего владельца аккаунта.
 */
@Module({
  imports: [
    ThrottlerModule.forRootAsync({
      inject: [ConfigService, RedisService],
      useFactory: (config: ConfigService, redis: RedisService) => {
        const window = (key: string) => config.getOrThrow<number>(key) * 1000;
        const loginTtl = window('RATE_LIMIT_LOGIN_WINDOW_SEC');
        return {
          errorMessage: 'Too many requests, try again later',
          // Redis — общие счётчики для всех экземпляров; без него — память процесса
          ...(redis.client
            ? {
                storage: new RedisThrottlerStorage(
                  redis.client,
                  new ThrottlerStorageService(),
                ),
              }
            : {}),
          throttlers: [
            {
              name: 'default',
              ttl: window('RATE_LIMIT_WINDOW_SEC'),
              limit: config.getOrThrow<number>('RATE_LIMIT_MAX'),
            },
            {
              name: 'login-account',
              ttl: loginTtl,
              limit: config.getOrThrow<number>('RATE_LIMIT_LOGIN_ACCOUNT_MAX'),
              skipIf: (ctx) => !isLoginRequest(ctx),
              getTracker: ipAndEmail,
            },
            {
              name: 'login-ip',
              ttl: loginTtl,
              limit: config.getOrThrow<number>('RATE_LIMIT_LOGIN_IP_MAX'),
              skipIf: (ctx) => !isLoginRequest(ctx),
            },
          ],
        };
      },
    }),
  ],
  // Регистрируется раньше JwtAuthGuard (см. порядок модулей в AppModule): 401 тоже считаются
  providers: [{ provide: APP_GUARD, useClass: AppThrottlerGuard }],
})
export class RateLimitModule {}
