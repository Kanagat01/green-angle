import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { UsersService } from '../src/users/users.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  login,
  PASSWORD,
} from './helpers.js';

const ALLOWED = 'https://app.example.com';
const ALSO_ALLOWED = 'http://localhost:3001';
const FOREIGN = 'https://evil.example.org';

// Выполняется до импортов: ConfigModule видит белый список Origin при валидации env
vi.hoisted(() => {
  process.env.CORS_ORIGINS = 'https://app.example.com, http://localhost:3001';
});

describe('Hardening (e2e)', () => {
  let app: NestFastifyApplication;
  let fx: Fixtures;
  let url: string;
  let token: string;
  const logLines: string[] = [];

  beforeAll(async () => {
    app = await createApp({
      listen: true,
      adapter: createFastifyAdapter(
        { LOG_LEVEL: 'info', TRUST_PROXY: false },
        { write: (line) => void logLines.push(line) },
      ),
    });
    url = await app.getUrl();
    fx = await createFixtures(app.get(PrismaService));
    token = await accessTokenFor(app, fx.broker.email);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  const request = (
    method: 'GET' | 'POST' | 'OPTIONS',
    path: string,
    headers: Record<string, string> = {},
    payload?: object | string,
  ) => app.inject({ method, url: `/api/v1${path}`, headers, payload });

  const logged = () =>
    logLines
      .flatMap((l) => l.split('\n'))
      .filter(Boolean)
      .map((l) => JSON.parse(l) as Record<string, any>);

  describe('security headers', () => {
    it('sets the helmet defaults and hides the framework', async () => {
      const res = await request('GET', '/health');
      expect(res.headers['x-content-type-options']).toBe('nosniff');
      expect(res.headers['strict-transport-security']).toMatch(/max-age=\d+/);
      expect(res.headers['x-frame-options']).toBeDefined();
      expect(res.headers['referrer-policy']).toBeDefined();
      expect(res.headers['content-security-policy']).toContain(
        "frame-ancestors 'none'",
      );
      expect(res.headers['x-powered-by']).toBeUndefined();
    });

    it('also applies to error responses', async () => {
      const res = await request('GET', '/me');
      expect(res.statusCode).toBe(401);
      expect(res.headers['x-content-type-options']).toBe('nosniff');
    });
  });

  describe('request id', () => {
    it('generates a uuid when none is supplied', async () => {
      const res = await request('GET', '/health');
      expect(res.headers['x-request-id']).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
      );
    });

    it('echoes a safe incoming id', async () => {
      const res = await request('GET', '/health', {
        'x-request-id': 'front-end.trace_42',
      });
      expect(res.headers['x-request-id']).toBe('front-end.trace_42');
    });

    it.each(['bad id with spaces', 'x'.repeat(65), 'quote"inject', 'a<b>'])(
      'replaces an unsafe incoming id %j',
      async (id) => {
        const res = await request('GET', '/health', { 'x-request-id': id });
        expect(res.headers['x-request-id']).not.toBe(id);
        expect(res.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/);
      },
    );

    it('is present on error responses', async () => {
      expect(
        (await request('GET', '/me')).headers['x-request-id'],
      ).toBeDefined();
      expect(
        (await request('GET', '/nope')).headers['x-request-id'],
      ).toBeDefined();
    });
  });

  describe('CORS', () => {
    it.each([ALLOWED, ALSO_ALLOWED])(
      'allows the configured origin %s',
      async (origin) => {
        const res = await request('GET', '/health', { origin });
        expect(res.headers['access-control-allow-origin']).toBe(origin);
        expect(res.headers['access-control-expose-headers']).toContain(
          'X-Request-Id',
        );
        expect(res.headers['vary']).toMatch(/origin/i);
      },
    );

    it('never answers with a wildcard and does not enable credentials', async () => {
      const res = await request('GET', '/health', { origin: ALLOWED });
      expect(res.headers['access-control-allow-origin']).not.toBe('*');
      expect(res.headers['access-control-allow-credentials']).toBeUndefined();
    });

    it.each([
      FOREIGN,
      'null',
      'https://app.example.com.evil.org',
      'http://app.example.com',
    ])('does not allow the origin %s', async (origin) => {
      const res = await request('GET', '/health', { origin });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('answers a preflight from an allowed origin', async () => {
      const res = await request('OPTIONS', '/requests', {
        origin: ALLOWED,
        'access-control-request-method': 'POST',
        'access-control-request-headers': 'authorization,content-type',
      });
      expect(res.statusCode).toBe(204);
      expect(res.headers['access-control-allow-origin']).toBe(ALLOWED);
      expect(res.headers['access-control-allow-methods']).toContain('POST');
      expect(res.headers['access-control-allow-headers']).toMatch(
        /authorization/i,
      );
      expect(res.headers['access-control-max-age']).toBe('600');
    });

    it('refuses a preflight from a foreign origin', async () => {
      const res = await request('OPTIONS', '/requests', {
        origin: FOREIGN,
        'access-control-request-method': 'POST',
      });
      expect(res.headers['access-control-allow-origin']).toBeUndefined();
    });

    it('applies the same allow-list to Socket.IO', async () => {
      const handshake = (origin: string) =>
        fetch(`${url}/socket.io/?EIO=4&transport=polling`, {
          headers: { origin },
        });

      const allowed = await handshake(ALLOWED);
      expect(allowed.headers.get('access-control-allow-origin')).toBe(ALLOWED);

      const foreign = await handshake(FOREIGN);
      expect(foreign.headers.get('access-control-allow-origin')).toBeNull();
    });
  });

  describe('request size and error handling', () => {
    it('rejects bodies over 1 MB with 413', async () => {
      const res = await request(
        'POST',
        '/auth/login',
        { 'content-type': 'application/json' },
        JSON.stringify({
          email: 'a@b.co',
          password: 'x'.repeat(2 * 1024 * 1024),
        }),
      );
      expect(res.statusCode).toBe(413);
    });

    it('does not leak internals on unexpected errors', async () => {
      vi.spyOn(app.get(UsersService), 'getProfile').mockRejectedValueOnce(
        new Error('connection to 10.1.2.3:5432 failed, password=hunter2'),
      );
      const res = await request('GET', '/me', {
        authorization: `Bearer ${token}`,
      });
      expect(res.statusCode).toBe(500);
      expect(res.json()).toEqual({
        statusCode: 500,
        message: 'Internal server error',
      });
      expect(res.body).not.toMatch(/10\.1\.2\.3|hunter2|stack|at /);
    });

    it('answers 404 for unknown routes without a stack trace', async () => {
      const res = await request('GET', '/definitely/not/here');
      expect(res.statusCode).toBe(404);
      expect(res.body).not.toMatch(/stack| at /);
    });
  });

  describe('request logging', () => {
    it('writes one structured line per request with user and request id', async () => {
      logLines.length = 0;
      const res = await request('GET', '/vehicles?limit=5&secret=abc', {
        authorization: `Bearer ${token}`,
        'x-request-id': 'trace-123',
      });
      expect(res.statusCode).toBe(200);
      await new Promise((r) => setTimeout(r, 50));

      const lines = logged().filter((l) => l.msg === 'request completed');
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        method: 'GET',
        path: '/api/v1/vehicles',
        statusCode: 200,
        userId: fx.broker.id,
        requestId: 'trace-123',
      });
      expect(typeof lines[0].responseTimeMs).toBe('number');
    });

    it('never writes tokens, passwords or query strings to the log', async () => {
      logLines.length = 0;
      await request('GET', '/requests?status=NEW&token=leaky', {
        authorization: `Bearer ${token}`,
      });
      await login(app, fx.broker.email, PASSWORD);
      await login(app, fx.broker.email, 'wrong-password-123');
      await new Promise((r) => setTimeout(r, 50));

      const raw = logLines.join('');
      expect(raw).not.toContain(token);
      expect(raw).not.toContain(PASSWORD);
      expect(raw).not.toContain('wrong-password-123');
      expect(raw).not.toContain('leaky');
      expect(raw).not.toMatch(/authorization/i);
      expect(raw).toContain('/api/v1/requests');
    });

    it('records failed requests with their status', async () => {
      logLines.length = 0;
      await request('GET', '/me');
      await new Promise((r) => setTimeout(r, 50));
      const line = logged().find((l) => l.msg === 'request completed');
      expect(line).toMatchObject({ path: '/api/v1/me', statusCode: 401 });
      expect(line?.userId).toBeUndefined();
    });

    it('does not log health probes', async () => {
      logLines.length = 0;
      await request('GET', '/health');
      await request('GET', '/health/ready');
      await new Promise((r) => setTimeout(r, 50));
      expect(
        logged().filter((l) => l.msg === 'request completed'),
      ).toHaveLength(0);
    });
  });
});
