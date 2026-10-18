import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  createApp,
  createFixtures,
  Fixtures,
  login,
  PASSWORD,
} from './helpers.js';

interface Tokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

describe('Auth (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    fx = await createFixtures(prisma);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  const refresh = (refreshToken: string) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/auth/refresh',
      payload: { refreshToken },
    });

  describe('login', () => {
    it('returns a token pair for valid credentials', async () => {
      const res = await login(app, fx.broker.email);
      expect(res.statusCode).toBe(200);
      const body = res.json<Tokens>();
      expect(body.accessToken).toEqual(expect.any(String));
      expect(body.refreshToken).toEqual(expect.any(String));
      expect(body.expiresIn).toBe(900);
    });

    it('rejects a wrong password', async () => {
      const res = await login(app, fx.broker.email, 'wrong-password-123');
      expect(res.statusCode).toBe(401);
    });

    it('rejects an unknown email', async () => {
      const res = await login(app, 'nobody@test.local', PASSWORD);
      expect(res.statusCode).toBe(401);
    });

    it('rejects a deactivated user', async () => {
      await prisma.user.update({
        where: { id: fx.individual.id },
        data: { isActive: false },
      });
      try {
        const res = await login(app, fx.individual.email);
        expect(res.statusCode).toBe(401);
      } finally {
        await prisma.user.update({
          where: { id: fx.individual.id },
          data: { isActive: true },
        });
      }
    });

    it('validates the payload', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/login',
        payload: { email: 'not-an-email', password: 'x' },
      });
      expect(res.statusCode).toBe(400);
    });
  });

  describe('GET /me', () => {
    it('requires a token', async () => {
      const res = await app.inject({ method: 'GET', url: '/api/v1/me' });
      expect(res.statusCode).toBe(401);
    });

    it('rejects a garbage token', async () => {
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: 'Bearer not.a.token' },
      });
      expect(res.statusCode).toBe(401);
    });

    it('does not accept a refresh token as an access token', async () => {
      const { refreshToken } = (
        await login(app, fx.broker.email)
      ).json<Tokens>();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: `Bearer ${refreshToken}` },
      });
      expect(res.statusCode).toBe(401);
    });

    it('returns the broker profile with its client', async () => {
      const { accessToken } = (
        await login(app, fx.broker.email)
      ).json<Tokens>();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.statusCode).toBe(200);
      expect(res.json()).toMatchObject({
        id: fx.broker.id,
        email: fx.broker.email,
        role: 'BROKER',
        client: { id: fx.broker.clientId, type: 'COMPANY' },
      });
    });

    it('returns client = null for admin', async () => {
      const { accessToken } = (await login(app, fx.admin.email)).json<Tokens>();
      const res = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: { authorization: `Bearer ${accessToken}` },
      });
      expect(res.json()).toMatchObject({ role: 'ADMIN', client: null });
    });
  });

  describe('refresh rotation', () => {
    it('issues a new pair and revokes the old refresh token', async () => {
      const first = (await login(app, fx.broker.email)).json<Tokens>();

      const res = await refresh(first.refreshToken);
      expect(res.statusCode).toBe(200);
      const second = res.json<Tokens>();
      expect(second.refreshToken).not.toBe(first.refreshToken);

      // новый токен работает
      expect((await refresh(second.refreshToken)).statusCode).toBe(200);
    });

    it('detects reuse of a rotated token and revokes the whole family', async () => {
      const first = (await login(app, fx.broker.email)).json<Tokens>();
      const second = (await refresh(first.refreshToken)).json<Tokens>();

      // повторное предъявление старого токена
      expect((await refresh(first.refreshToken)).statusCode).toBe(401);
      // вся цепочка отозвана, включая актуальный токен
      expect((await refresh(second.refreshToken)).statusCode).toBe(401);
    });

    it('allows only one of two concurrent refreshes with the same token', async () => {
      const { refreshToken } = (
        await login(app, fx.broker.email)
      ).json<Tokens>();
      const results = await Promise.all([
        refresh(refreshToken),
        refresh(refreshToken),
      ]);
      const statuses = results.map((r) => r.statusCode).sort((a, b) => a - b);
      expect(statuses).toEqual([200, 401]);
    });

    it('rejects an expired refresh token', async () => {
      const { refreshToken } = (
        await login(app, fx.broker.email)
      ).json<Tokens>();
      await prisma.refreshToken.updateMany({
        where: { userId: fx.broker.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });
      expect((await refresh(refreshToken)).statusCode).toBe(401);
    });

    it('rejects a refresh for a user deactivated after login', async () => {
      const { refreshToken } = (
        await login(app, fx.individual.email)
      ).json<Tokens>();
      await prisma.user.update({
        where: { id: fx.individual.id },
        data: { isActive: false },
      });
      try {
        expect((await refresh(refreshToken)).statusCode).toBe(401);
      } finally {
        await prisma.user.update({
          where: { id: fx.individual.id },
          data: { isActive: true },
        });
      }
    });

    it('rejects a garbage refresh token', async () => {
      expect((await refresh('garbage')).statusCode).toBe(401);
    });
  });

  describe('logout', () => {
    it('revokes the refresh token chain', async () => {
      const { refreshToken } = (
        await login(app, fx.broker.email)
      ).json<Tokens>();

      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken },
      });
      expect(res.statusCode).toBe(204);
      expect((await refresh(refreshToken)).statusCode).toBe(401);
    });

    it('is idempotent and ignores invalid tokens', async () => {
      const res = await app.inject({
        method: 'POST',
        url: '/api/v1/auth/logout',
        payload: { refreshToken: 'garbage' },
      });
      expect(res.statusCode).toBe(204);
    });
  });
});
