import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, createFixtures, Fixtures, PASSWORD } from './helpers.js';

// Выполняется до импортов, поэтому ConfigModule видит эти значения при валидации env
vi.hoisted(() => {
  process.env.RATE_LIMIT_LOGIN_ACCOUNT_MAX = '3';
  process.env.RATE_LIMIT_LOGIN_IP_MAX = '8';
  process.env.RATE_LIMIT_LOGIN_WINDOW_SEC = '3';
  process.env.RATE_LIMIT_MAX = '20';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  process.env.TRUST_PROXY = 'true';
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe('Rate limiting (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;

  /** Каждый тест получает чистые счётчики — отдельный экземпляр приложения. */
  beforeEach(async () => {
    app = await createApp({
      adapter: createFastifyAdapter({ LOG_LEVEL: 'fatal', TRUST_PROXY: true }),
    });
    prisma = app.get(PrismaService);
    fx ??= await createFixtures(prisma);
  });

  afterEach(() => app.close());

  afterAll(async () => {
    const cleanupApp = await createApp();
    await fx.cleanup();
    await cleanupApp.close();
  });

  const login = (email: string, password: string, ip = '10.0.0.1') =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/login',
      headers: { 'x-forwarded-for': ip },
      payload: { email, password },
    });
  const get = (url: string, ip = '10.0.0.1') =>
    app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: { 'x-forwarded-for': ip },
    });

  describe('login by account (IP + email)', () => {
    it('blocks the 4th attempt, even with the right password, and says when to retry', async () => {
      for (let i = 0; i < 3; i++) {
        expect(
          (await login(fx.broker.email, 'wrong-password-1')).statusCode,
        ).toBe(401);
      }
      const blocked = await login(fx.broker.email, PASSWORD);
      expect(blocked.statusCode).toBe(429);
      expect(blocked.json()).toMatchObject({ statusCode: 429 });
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    });

    it('counts successful logins too', async () => {
      for (let i = 0; i < 3; i++) {
        expect((await login(fx.broker.email, PASSWORD)).statusCode).toBe(200);
      }
      expect((await login(fx.broker.email, PASSWORD)).statusCode).toBe(429);
    });

    it('treats email case-insensitively', async () => {
      const upper = fx.broker.email.toUpperCase();
      await login(fx.broker.email, 'wrong-password-1');
      await login(upper, 'wrong-password-1');
      await login(` ${fx.broker.email} `, 'wrong-password-1');
      expect((await login(upper, PASSWORD)).statusCode).toBe(429);
    });

    it('does not lock the account out for the rightful owner on another IP', async () => {
      for (let i = 0; i < 3; i++)
        await login(fx.broker.email, 'wrong-password-1', '203.0.113.9');
      expect(
        (await login(fx.broker.email, PASSWORD, '203.0.113.9')).statusCode,
      ).toBe(429);
      // тот же email с другого адреса работает
      expect(
        (await login(fx.broker.email, PASSWORD, '198.51.100.7')).statusCode,
      ).toBe(200);
    });

    it('does not affect other accounts from the same IP', async () => {
      for (let i = 0; i < 3; i++)
        await login(fx.broker.email, 'wrong-password-1');
      expect((await login(fx.broker.email, PASSWORD)).statusCode).toBe(429);
      expect((await login(fx.individual.email, PASSWORD)).statusCode).toBe(200);
    });

    it('allows attempts again after the window passes', async () => {
      for (let i = 0; i < 3; i++)
        await login(fx.broker.email, 'wrong-password-1');
      expect((await login(fx.broker.email, PASSWORD)).statusCode).toBe(429);

      await sleep(3300);
      expect((await login(fx.broker.email, PASSWORD)).statusCode).toBe(200);
    }, 10_000);
  });

  describe('registration and resend share the credential limits', () => {
    const register = (email: string, ip = '10.0.0.1') =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/register',
        headers: { 'x-forwarded-for': ip },
        payload: {
          type: 'PERSON',
          name: 'Тест Лимитов',
          phone: '+79001234567',
          email,
          password: PASSWORD,
          consent: true,
        },
      });
    const resend = (email: string, ip = '10.0.0.1') =>
      app.inject({
        method: 'POST',
        url: '/api/v1/auth/resend-verification',
        headers: { 'x-forwarded-for': ip },
        payload: { email },
      });

    it('blocks repeated resend requests for one address', async () => {
      const email = `limit-${fx.tag}@test.local`;
      for (let i = 0; i < 3; i++) {
        expect((await resend(email)).statusCode).toBe(202);
      }
      const blocked = await resend(email);
      expect(blocked.statusCode).toBe(429);
      expect(Number(blocked.headers['retry-after'])).toBeGreaterThanOrEqual(1);
      // другой адрес с того же IP ещё может
      expect((await resend(`other-${fx.tag}@test.local`)).statusCode).toBe(202);
    });

    it('blocks one IP that registers too many addresses', async () => {
      for (let i = 0; i < 8; i++) {
        expect(
          (await register(`bulk-${i}-${fx.tag}@test.local`)).statusCode,
        ).toBe(202);
      }
      expect((await register(`bulk-9-${fx.tag}@test.local`)).statusCode).toBe(
        429,
      );
      expect(
        (await register(`bulk-9-${fx.tag}@test.local`, '198.51.100.7'))
          .statusCode,
      ).toBe(202);
    });

    afterAll(async () => {
      const cleanupApp = await createApp();
      const prismaClean = cleanupApp.get(PrismaService);
      const users = await prismaClean.user.findMany({
        // только созданные регистрацией; почты фикстур (broker-…, admin-…) здесь трогать нельзя
        where: {
          OR: ['bulk-', 'limit-', 'other-'].map((prefix) => ({
            email: { startsWith: prefix, endsWith: `-${fx.tag}@test.local` },
          })),
        },
        select: { id: true, clientId: true },
      });
      await prismaClean.user.deleteMany({
        where: { id: { in: users.map((u) => u.id) } },
      });
      await prismaClean.client.deleteMany({
        where: {
          id: { in: users.flatMap((u) => (u.clientId ? [u.clientId] : [])) },
        },
      });
      await cleanupApp.close();
    });
  });

  describe('login by IP (credential stuffing)', () => {
    it('blocks one IP that tries many different accounts', async () => {
      for (let i = 0; i < 8; i++) {
        const res = await login(
          `nobody-${i}-${fx.tag}@test.local`,
          'wrong-password-1',
        );
        expect(res.statusCode).toBe(401);
      }
      const ninth = await login(
        `nobody-9-${fx.tag}@test.local`,
        'wrong-password-1',
      );
      expect(ninth.statusCode).toBe(429);
      // даже существующий аккаунт с этого адреса уже недоступен
      expect((await login(fx.individual.email, PASSWORD)).statusCode).toBe(429);
    });

    it('does not affect other IPs', async () => {
      for (let i = 0; i < 9; i++)
        await login(`nobody-${i}-${fx.tag}@test.local`, 'x'.repeat(8));
      expect(
        (await login(fx.individual.email, PASSWORD, '198.51.100.7')).statusCode,
      ).toBe(200);
    });
  });

  describe('general limit per IP', () => {
    it('answers 429 after the allowed number of requests, also for rejected (401) ones', async () => {
      const statuses: number[] = [];
      for (let i = 0; i < 22; i++) statuses.push((await get('/me')).statusCode);
      expect(statuses.slice(0, 20)).toEqual(Array(20).fill(401));
      expect(statuses.slice(20)).toEqual([429, 429]);
    });

    it('is tracked per IP', async () => {
      for (let i = 0; i < 21; i++) await get('/me', '192.0.2.1');
      expect((await get('/me', '192.0.2.1')).statusCode).toBe(429);
      expect((await get('/me', '192.0.2.2')).statusCode).toBe(401);
    });

    it('never throttles the health endpoints', async () => {
      for (let i = 0; i < 40; i++) {
        expect((await get('/health')).statusCode).toBe(200);
      }
      expect((await get('/health/ready')).statusCode).toBe(200);
    });

    it('counts login requests against the general limit as well', async () => {
      const statuses: number[] = [];
      // каждый запрос — другой email и IP, чтобы не упереться в лимиты входа
      for (let i = 0; i < 22; i++) {
        statuses.push(
          (
            await app.inject({
              method: 'POST',
              url: '/api/v1/auth/login',
              headers: { 'x-forwarded-for': '10.9.9.9' },
              payload: {
                email: `x${i}-${fx.tag}@test.local`,
                password: 'wrong-password-1',
              },
            })
          ).statusCode,
        );
      }
      // IP-лимит входа (8) срабатывает раньше общего (20)
      expect(statuses.filter((s) => s === 401)).toHaveLength(8);
      expect(statuses.filter((s) => s === 429).length).toBe(14);
    });
  });
});
