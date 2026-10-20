import { ThrottlerStorageService } from '@nestjs/throttler';
import { Redis } from 'ioredis';
import { randomUUID } from 'node:crypto';
import { RedisThrottlerStorage } from '../src/rate-limit/redis-throttler-storage.js';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Redis нужен тестам; локально без него пропускаем, в CI его отсутствие — ошибка. */
const redisUp = await (async () => {
  const probe = new Redis(REDIS_URL, {
    lazyConnect: true,
    connectTimeout: 1000,
    maxRetriesPerRequest: 0,
    retryStrategy: () => null,
  });
  try {
    await probe.connect();
    await probe.ping();
    return true;
  } catch {
    return false;
  } finally {
    probe.disconnect();
  }
})();

describe.runIf(redisUp || !!process.env.CI)(
  'RedisThrottlerStorage (real Redis)',
  () => {
    let redis: Redis;
    let storage: RedisThrottlerStorage;
    const namePrefix = `t${randomUUID().slice(0, 6)}`;
    const key = () => `${namePrefix}-${randomUUID()}`;
    let seq = 0;
    const name = () => `${namePrefix}-n${++seq}`;

    beforeAll(() => {
      redis = new Redis(REDIS_URL);
      storage = new RedisThrottlerStorage(redis, new ThrottlerStorageService());
    });

    afterAll(async () => {
      const keys = await redis.keys(`throttle:${namePrefix}-*`);
      if (keys.length) await redis.del(...keys);
      redis.disconnect();
    });

    describe('with blocking (blockDuration > 0, the mode used by the API)', () => {
      it('counts hits up to the limit, then blocks', async () => {
        const k = key();
        const n = name();
        for (let i = 1; i <= 3; i++) {
          const r = await storage.increment(k, 60_000, 3, 60_000, n);
          expect(r).toMatchObject({
            totalHits: i,
            isBlocked: false,
            timeToBlockExpire: 0,
          });
          expect(r.timeToExpire).toBeGreaterThanOrEqual(1);
          expect(r.timeToExpire).toBeLessThanOrEqual(60);
        }
        const blocked = await storage.increment(k, 60_000, 3, 60_000, n);
        expect(blocked).toMatchObject({ isBlocked: true });
        expect(blocked.totalHits).toBeGreaterThan(3);
        expect(blocked.timeToBlockExpire).toBeGreaterThanOrEqual(59);
        expect(blocked.timeToBlockExpire).toBeLessThanOrEqual(60);
      });

      it('keeps blocking on further hits without extending the block', async () => {
        const k = key();
        const n = name();
        for (let i = 0; i < 3; i++)
          await storage.increment(k, 60_000, 2, 3_000, n);
        const first = await storage.increment(k, 60_000, 2, 3_000, n);
        await sleep(1100);
        const later = await storage.increment(k, 60_000, 2, 3_000, n);
        expect(first.isBlocked && later.isBlocked).toBe(true);
        // повторные запросы не продлевают блокировку
        expect(later.timeToBlockExpire).toBeLessThan(first.timeToBlockExpire);
      });

      it('lets the caller in again after the block expires, with a fresh counter', async () => {
        const k = key();
        const n = name();
        for (let i = 0; i < 3; i++)
          await storage.increment(k, 60_000, 2, 1_500, n);
        expect(
          (await storage.increment(k, 60_000, 2, 1_500, n)).isBlocked,
        ).toBe(true);

        await sleep(1700);
        const after = await storage.increment(k, 60_000, 2, 1_500, n);
        expect(after).toMatchObject({ isBlocked: false, totalHits: 1 });
      });

      it('forgets hits outside the sliding window', async () => {
        const k = key();
        const n = name();
        await storage.increment(k, 1_000, 5, 1_000, n);
        await storage.increment(k, 1_000, 5, 1_000, n);
        await sleep(1200);
        const r = await storage.increment(k, 1_000, 5, 1_000, n);
        expect(r.totalHits).toBe(1);
      });
    });

    describe('without blocking (blockDuration = 0)', () => {
      it('rejects over the limit without counting the rejected hits', async () => {
        const k = key();
        const n = name();
        for (let i = 1; i <= 2; i++) {
          expect((await storage.increment(k, 1_000, 2, 0, n)).isBlocked).toBe(
            false,
          );
        }
        const rejected = await storage.increment(k, 1_000, 2, 0, n);
        expect(rejected.isBlocked).toBe(true);
        expect(rejected.timeToBlockExpire).toBeGreaterThanOrEqual(1);

        await sleep(1200);
        expect((await storage.increment(k, 1_000, 2, 0, n)).isBlocked).toBe(
          false,
        );
      });
    });

    it('keeps keys and limiter names independent', async () => {
      const a = key();
      const b = key();
      const n1 = name();
      const n2 = name();
      for (let i = 0; i < 3; i++)
        await storage.increment(a, 60_000, 2, 60_000, n1);
      expect(
        (await storage.increment(a, 60_000, 2, 60_000, n1)).isBlocked,
      ).toBe(true);
      expect(
        (await storage.increment(b, 60_000, 2, 60_000, n1)).totalHits,
      ).toBe(1);
      expect(
        (await storage.increment(a, 60_000, 2, 60_000, n2)).totalHits,
      ).toBe(1);
    });

    it('is atomic: parallel hits never let more than the limit through', async () => {
      const k = key();
      const n = name();
      const results = await Promise.all(
        Array.from({ length: 60 }, () =>
          storage.increment(k, 60_000, 10, 60_000, n),
        ),
      );
      expect(results.filter((r) => !r.isBlocked)).toHaveLength(10);
      expect(results.filter((r) => r.isBlocked)).toHaveLength(50);
    });

    it('is atomic across separate connections (as separate API instances would be)', async () => {
      const other = new Redis(REDIS_URL);
      const second = new RedisThrottlerStorage(
        other,
        new ThrottlerStorageService(),
      );
      try {
        const k = key();
        const n = name();
        const results = await Promise.all(
          Array.from({ length: 40 }, (_, i) =>
            (i % 2 ? storage : second).increment(k, 60_000, 7, 60_000, n),
          ),
        );
        expect(results.filter((r) => !r.isBlocked)).toHaveLength(7);
      } finally {
        other.disconnect();
      }
    });

    it('stores keys with a TTL so they cannot pile up', async () => {
      const k = key();
      const n = name();
      await storage.increment(k, 5_000, 3, 5_000, n);
      const ttl = await redis.pttl(`throttle:${n}:${k}:hits`);
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(5_000);
    });

    describe('when Redis fails', () => {
      it('on a dropped connection fails fast, keeps limiting in memory and never throws', async () => {
        // клиент настроен так же, как в RedisService: без очереди офлайн-команд
        const dropped = new Redis(REDIS_URL, {
          enableOfflineQueue: false,
          maxRetriesPerRequest: 0,
        });
        const guarded = new RedisThrottlerStorage(
          dropped,
          new ThrottlerStorageService(),
        );
        const n = name();
        expect(
          (await guarded.increment(key(), 60_000, 2, 60_000, n)).totalHits,
        ).toBe(1);

        dropped.disconnect(); // обрыв соединения
        const k = key();
        const started = Date.now();
        const seen = [];
        for (let i = 0; i < 4; i++) {
          seen.push(await guarded.increment(k, 60_000, 2, 60_000, n));
        }
        // запросы не падают и не зависают, лимит продолжает действовать (в памяти процесса)
        expect(Date.now() - started).toBeLessThan(1500);
        expect(seen.map((r) => r.isBlocked)).toEqual([
          false,
          false,
          true,
          true,
        ]);
      });

      it('returns to Redis counting once it works again (after the back-off)', async () => {
        // управляемый сбой: прокси подменяет Lua-команду, пока failing = true
        let failing = false;
        const flaky = new Proxy(redis, {
          get(target, prop) {
            if (prop === 'throttleIncrement') {
              return (...args: unknown[]) =>
                failing
                  ? Promise.reject(new Error('connection is closed'))
                  : (
                      target as unknown as Record<
                        string,
                        (...a: unknown[]) => Promise<unknown>
                      >
                    ).throttleIncrement(...args);
            }
            const value = Reflect.get(target, prop, target) as unknown;
            return typeof value === 'function'
              ? (value as (...a: unknown[]) => unknown).bind(target)
              : value;
          },
        });
        const guarded = new RedisThrottlerStorage(
          flaky,
          new ThrottlerStorageService(),
        );
        const k = key();
        const n = name();

        expect(
          (await guarded.increment(k, 60_000, 5, 60_000, n)).totalHits,
        ).toBe(1);
        failing = true;
        // счёт ушёл в память: Redis этот запрос не видел
        expect(
          (await guarded.increment(k, 60_000, 5, 60_000, n)).totalHits,
        ).toBe(1);

        failing = false; // Redis снова работает, но в паузе (5 с) к нему ещё не ходим
        expect(
          (await guarded.increment(k, 60_000, 5, 60_000, n)).totalHits,
        ).toBe(2); // это память
        await sleep(5300);
        // пауза закончилась: счёт продолжается в Redis с того места, где он был до сбоя
        expect(
          (await guarded.increment(k, 60_000, 5, 60_000, n)).totalHits,
        ).toBe(2);
      }, 15_000);
    });
  },
);
