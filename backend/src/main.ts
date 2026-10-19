import 'dotenv/config';
import { ConsoleLogger, LogLevel } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { configureApp, createFastifyAdapter } from './app.setup.js';
import { Env, validateEnv } from './config/env.js';

/** Уровни логгера Nest по LOG_LEVEL (pino-уровни → уровни Nest). */
const NEST_LEVELS: Record<Env['LOG_LEVEL'], LogLevel[]> = {
  fatal: ['fatal'],
  error: ['fatal', 'error'],
  warn: ['fatal', 'error', 'warn'],
  info: ['fatal', 'error', 'warn', 'log'],
  debug: ['fatal', 'error', 'warn', 'log', 'debug'],
  trace: ['fatal', 'error', 'warn', 'log', 'debug', 'verbose'],
};

async function bootstrap() {
  // Ошибка конфигурации — сразу и понятно, до создания приложения
  const env = validateEnv(process.env);
  const isProd = env.NODE_ENV === 'production';

  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    createFastifyAdapter(env),
    {
      // В production — структурные JSON-строки, пригодные для сбора логов
      logger: new ConsoleLogger({
        json: isProd,
        colors: !isProd,
        logLevels: NEST_LEVELS[env.LOG_LEVEL],
      }),
    },
  );
  await configureApp(app);
  // SIGTERM/SIGINT: дождаться запросов, закрыть сокеты и соединения с БД
  app.enableShutdownHooks();

  if (env.SWAGGER_ENABLED) {
    const docs = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('Green Angle API')
        .setVersion('0.1.0')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('api/docs', app, docs);
  }

  await app.listen(
    app.get(ConfigService).getOrThrow<number>('PORT'),
    '0.0.0.0',
  );
}
void bootstrap();
