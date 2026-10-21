import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import fastifyHelmet from '@fastify/helmet';
import { LogController } from 'fastify';
import { randomUUID } from 'node:crypto';
import type { IncomingMessage } from 'node:http';
import type { Env } from './config/env.js';
import { SocketIoAdapter } from './realtime/socket-io.adapter.js';

const MAX_BODY_BYTES = 1024 * 1024;
const REQUEST_ID_HEADER = 'x-request-id';
/** Входящий X-Request-Id принимается, только если это безопасная короткая строка */
const SAFE_REQUEST_ID = /^[A-Za-z0-9._-]{1,64}$/;

/** Пути, чьи запросы не пишем в лог (частые проверки живости). */
const QUIET_PATHS = new Set(['/api/v1/health', '/api/v1/health/ready']);

/**
 * Fastify-адаптер для боевого запуска: JSON-логи pino без заголовков авторизации,
 * корреляционный id запроса, ограничение размера тела и доверие к прокси.
 * (Каждый запрос логируется одной строкой в `configureApp`.)
 */
export function createFastifyAdapter(
  env: Pick<Env, 'LOG_LEVEL' | 'TRUST_PROXY'>,
  /** Куда писать логи (по умолчанию stdout); нужен тестам, чтобы прочитать строки лога */
  logStream?: { write(line: string): void },
): FastifyAdapter {
  return new FastifyAdapter({
    trustProxy: env.TRUST_PROXY,
    // Лимит относится к JSON; файлы (до 500 МБ) идут потоком и ограничены правилами загрузки
    bodyLimit: MAX_BODY_BYTES,
    // Node по умолчанию обрывает запрос, который принимается дольше 5 минут, — для видео на медленном канале мало
    requestTimeout: 30 * 60 * 1000,
    // Стандартные строки Fastify о запросе отключены: вместо них одна строка из onResponse
    logController: new LogController({
      disableRequestLogging: true,
      requestIdLogLabel: 'requestId',
    }),
    genReqId: (req: IncomingMessage) => {
      const incoming = req.headers[REQUEST_ID_HEADER];
      return typeof incoming === 'string' && SAFE_REQUEST_ID.test(incoming)
        ? incoming
        : randomUUID();
    },
    logger: {
      level: env.LOG_LEVEL,
      ...(logStream ? { stream: logStream } : {}),
      redact: {
        paths: ['req.headers.authorization', 'req.headers.cookie'],
        censor: '[redacted]',
      },
    },
  });
}

/**
 * Общая настройка приложения (боевой запуск и тесты): префикс API, валидация, заголовки
 * безопасности, CORS, request-id и сокеты.
 */
export async function configureApp(app: NestFastifyApplication) {
  const config = app.get(ConfigService);
  const origins = config.get<string[]>('CORS_ORIGINS') ?? [];

  app.setGlobalPrefix('api/v1', { exclude: [] });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));

  // API отдаёт JSON; CSP разрешает собственные скрипты/стили для Swagger UI
  await app.register(fastifyHelmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        imgSrc: ["'self'", 'data:'],
        frameAncestors: ["'none'"],
      },
    },
  });

  if (origins.length > 0) {
    app.enableCors({
      origin: origins,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
      allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id'],
      exposedHeaders: ['X-Request-Id', 'Retry-After'],
      maxAge: 600,
    });
  }

  const fastify = app.getHttpAdapter().getInstance();
  // Загрузка файлов на диск: тело любого не-JSON типа отдаётся потоком (читает его FilesController)
  fastify.addContentTypeParser('*', (_req, payload, done) =>
    done(null, payload),
  );
  fastify.addHook('onSend', async (req, reply) => {
    void reply.header(REQUEST_ID_HEADER, req.id);
  });
  // Одна строка на запрос: метод, путь без query, статус, время, пользователь. Тел и заголовков нет.
  fastify.addHook('onResponse', async (req, reply) => {
    const path = req.url.split('?')[0];
    if (QUIET_PATHS.has(path)) return;
    const userId = (req as { user?: { id?: string } }).user?.id;
    req.log.info(
      {
        method: req.method,
        path,
        statusCode: reply.statusCode,
        responseTimeMs: Math.round(reply.elapsedTime),
        ip: req.ip,
        userId,
      },
      'request completed',
    );
  });

  app.useWebSocketAdapter(new SocketIoAdapter(app).withOrigins(origins));
}
