import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { Redis } from 'ioredis';
import { randomInt } from 'node:crypto';
import { createFastifyAdapter } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { RedisService } from '../src/redis/redis.service.js';
import { createApp, createFixtures, Fixtures, PASSWORD } from './helpers.js';

const REDIS_URL = process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';

// Выполняется до импортов, поэтому ConfigModule видит эти значения при валидации env
vi.hoisted(() => {
  process.env.REDIS_URL =
    process.env.TEST_REDIS_URL ?? 'redis://localhost:6379';
  process.env.RATE_LIMIT_LOGIN_ACCOUNT_MAX = '3';
  process.env.RATE_LIMIT_LOGIN_IP_MAX = '8';
  process.env.RATE_LIMIT_LOGIN_WINDOW_SEC = '3';
  process.env.RATE_LIMIT_MAX = '20';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  process.env.TRUST_PROXY = 'true';
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

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

/** Уникальный «клиентский» IP на тест — счётчики в общем Redis не пересекаются между тестами. */
const uniqueIp = () =>
  `10.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

describe.runIf(redisUp || !!process.env.CI)(
  'Rate limiting on shared Redis (e2e)',
  () => {
    let a: NestFastifyApplication; // «экземпляр 1»
    let b: NestFastifyApplication; // «экземпляр 2» — отдельный процесс в боевой среде
    let fx: Fixtures;
    let inspector: Redis;

    const newApp = () =>
      createApp({
        adapter: createFastifyAdapter({
          LOG_LEVEL: 'fatal',
          TRUST_PROXY: true,
        }),
      });

    beforeAll(async () => {
      a = await newApp();
      b = await newApp();
      fx = await createFixtures(a.get(PrismaService));
      inspector = new Redis(REDIS_URL);
    });

    afterAll(async () => {
      await fx.cleanup();
      inspector.disconnect();
      await Promise.all([a.close(), b.close()]);
    });

    const login = (
      app: NestFastifyApplication,
      email: string,
      password: string,
      ip: string,
    ) =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        headers: { 'x-forwarded-for': ip },
        payload: { email, password },
      });
    const get = (app: NestFastifyApplication, url: string, ip: string) =>
      app.inject({
        method: 'GET',
        url: `/api/v1${url}`,
        headers: { 'x-forwarded-for': ip },
      });

    it('wires the shared Redis storage into both instances', () => {
      expect(a.get(RedisService).client).not.toBeNull();
      expect(b.get(RedisService).client).not.toBeNull();
    });

    it('counts login attempts across instances (account limit)', async () => {
      const ip = uniqueIp();
      expect(
        (await login(a, fx.broker.email, 'wrong-password-1', ip)).statusCode,
      ).toBe(401);
      expect(
        (await login(b, fx.broker.email, 'wrong-password-1', ip)).statusCode,
      ).toBe(401);
      expect(
        (await login(a, fx.broker.email, 'wrong-password-1', ip)).statusCode,
      ).toBe(401);

      // четвёртая попытка — на другом экземпляре; в памяти процесса он бы её пропустил
      const blocked = await login(b, fx.broker.email, PASSWORD, ip);
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
      // и первый экземпляр тоже видит блокировку
      expect((await login(a, fx.broker.email, PASSWORD, ip)).statusCode).toBe(
        429,
      );
    });

    it('counts login attempts across instances (IP limit, credential stuffing)', async () => {
      const ip = uniqueIp();
      for (let i = 0; i < 8; i++) {
        const res = await login(
          i % 2 ? a : b,
          `nobody-${i}-${fx.tag}@test.local`,
          'wrong-password-1',
          ip,
        );
        expect(res.statusCode).toBe(401);
      }
      expect(
        (
          await login(
            a,
            `nobody-9-${fx.tag}@test.local`,
            'wrong-password-1',
            ip,
          )
        ).statusCode,
      ).toBe(429);
      expect(
        (await login(b, fx.individual.email, PASSWORD, ip)).statusCode,
      ).toBe(429);
    });

    it('shares the general per-IP limit across instances', async () => {
      const ip = uniqueIp();
      const statuses: number[] = [];
      for (let i = 0; i < 22; i++)
        statuses.push((await get(i % 2 ? a : b, '/me', ip)).statusCode);
      expect(statuses.slice(0, 20)).toEqual(Array(20).fill(401));
      expect(statuses.slice(20)).toEqual([429, 429]);
    });

    it('keeps different IPs and different accounts independent', async () => {
      const blockedIp = uniqueIp();
      for (let i = 0; i < 3; i++)
        await login(a, fx.broker.email, 'wrong-password-1', blockedIp);
      expect(
        (await login(b, fx.broker.email, PASSWORD, blockedIp)).statusCode,
      ).toBe(429);

      expect(
        (await login(b, fx.broker.email, PASSWORD, uniqueIp())).statusCode,
      ).toBe(200);
      expect(
        (await login(b, fx.individual.email, PASSWORD, blockedIp)).statusCode,
      ).toBe(200);
    });

    it('lets the caller in again once the window passes', async () => {
      const ip = uniqueIp();
      for (let i = 0; i < 3; i++)
        await login(a, fx.broker.email, 'wrong-password-1', ip);
      expect((await login(b, fx.broker.email, PASSWORD, ip)).statusCode).toBe(
        429,
      );

      await sleep(3300);
      expect((await login(b, fx.broker.email, PASSWORD, ip)).statusCode).toBe(
        200,
      );
    }, 10_000);

    it('stores only hashed keys with a TTL — no emails or addresses in Redis', async () => {
      const ip = uniqueIp();
      const email = `visible-${fx.tag}@test.local`;
      await login(a, email, 'wrong-password-1', ip);

      const keys = await inspector.keys('throttle:login-account:*');
      expect(keys.length).toBeGreaterThan(0);
      for (const key of keys) {
        expect(key).not.toContain(email);
        expect(key).not.toContain(ip);
      }
      const ttls = await Promise.all(keys.map((k) => inspector.pttl(k)));
      expect(ttls.every((t) => t > 0 && t <= 3000)).toBe(true);
    });

    describe('readiness', () => {
      it('reports Redis as up', async () => {
        const res = await get(a, '/health/ready', uniqueIp());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
          status: 'ok',
          checks: { database: 'up', storage: 'up', redis: 'up' },
        });
      });
    });

    describe('when this instance loses Redis', () => {
      let degraded: NestFastifyApplication;

      beforeAll(async () => {
        degraded = await newApp();
        // обрыв только у этого экземпляра; остальные продолжают работать с Redis
        degraded.get(RedisService).client!.disconnect();
      });

      afterAll(() => degraded.close());

      it('keeps serving requests quickly and still limits logins (in memory)', async () => {
        const ip = uniqueIp();
        const started = Date.now();
        const statuses: number[] = [];
        for (let i = 0; i < 4; i++) {
          statuses.push(
            (await login(degraded, fx.broker.email, 'wrong-password-1', ip))
              .statusCode,
          );
        }
        expect(statuses).toEqual([401, 401, 401, 429]);
        // быстрый отказ от Redis: argon2 (4 проверки) укладывается в разумное время
        expect(Date.now() - started).toBeLessThan(3000);
      });

      it('reports degraded readiness, not 503, because the API itself works', async () => {
        const res = await get(degraded, '/health/ready', uniqueIp());
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({
          status: 'degraded',
          checks: { database: 'up', storage: 'up', redis: 'down' },
        });
      });

      it('does not affect the healthy instances', async () => {
        const res = await get(a, '/health/ready', uniqueIp());
        expect(res.json<{ checks: { redis: string } }>().checks.redis).toBe(
          'up',
        );
      });
    });
  },
);
