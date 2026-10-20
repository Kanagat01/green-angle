import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';

const READY_WAIT_MS = 2000;

/**
 * Клиент Redis (если задан REDIS_URL). Настроен «быстро падать»: без очереди офлайн-команд и
 * с коротким таймаутом, чтобы недоступный Redis не замедлял запросы — потребители (rate limit)
 * сами переключаются на запасной вариант.
 */
@Injectable()
export class RedisService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  /** null — Redis не настроен */
  readonly client: Redis | null;
  private connected = false;

  constructor(config: ConfigService) {
    const url = config.get<string | undefined>('REDIS_URL');
    if (!url) {
      this.client = null;
      return;
    }

    this.client = new Redis(url, {
      enableOfflineQueue: false,
      maxRetriesPerRequest: 1,
      connectTimeout: 2000,
      commandTimeout: 500,
      retryStrategy: (attempt) => Math.min(attempt * 200, 5000),
    });
    this.client.on('ready', () => {
      this.connected = true;
      this.logger.log('Redis connected');
    });
    // ioredis шлёт error при каждой неудачной попытке переподключения — логируем только переход
    this.client.on('error', (err: Error) => {
      if (this.connected)
        this.logger.warn(`Redis connection lost: ${err.message}`);
      this.connected = false;
    });
  }

  /** Дожидается подключения, но не дольше пары секунд: старт API не зависит от Redis. */
  async onModuleInit() {
    if (!this.client || this.client.status === 'ready') return;
    await new Promise<void>((resolve) => {
      const timer = setTimeout(resolve, READY_WAIT_MS);
      this.client!.once('ready', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (!this.connected) {
      this.logger.warn(
        'Redis is not reachable yet; rate limits fall back to in-memory counters',
      );
    }
  }

  /** up / down; undefined — Redis не настроен. */
  async status(): Promise<'up' | 'down' | undefined> {
    if (!this.client) return undefined;
    try {
      await this.client.ping();
      return 'up';
    } catch {
      return 'down';
    }
  }

  async onModuleDestroy() {
    if (!this.client) return;
    try {
      await this.client.quit();
    } catch {
      this.client.disconnect();
    }
  }
}
