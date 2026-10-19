import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { StorageService } from '../src/storage/storage.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp } from './helpers.js';

describe('Health (e2e)', () => {
  let app: NestFastifyApplication;

  beforeAll(async () => {
    app = await createApp();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  afterAll(() => app.close());

  const get = (url: string) =>
    app.inject({ method: 'GET', url: `/api/v1${url}` });

  it('GET /health reports liveness without touching dependencies', async () => {
    vi.spyOn(app.get(PrismaService), '$queryRaw').mockRejectedValue(
      new Error('db down'),
    );
    const res = await get('/health');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ status: 'ok' });
  });

  it('GET /health/ready is ok when database and storage are reachable', async () => {
    const res = await get('/health/ready');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      status: 'ok',
      checks: { database: 'up', storage: 'up' },
    });
  });

  it('GET /health/ready answers 503 when the database is down, without leaking details', async () => {
    vi.spyOn(app.get(PrismaService), '$queryRaw').mockRejectedValue(
      new Error('connect ECONNREFUSED 10.0.0.5:5432 password=secret'),
    );
    const res = await get('/health/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      status: 'unavailable',
      checks: { database: 'down', storage: 'up' },
    });
    expect(res.body).not.toMatch(/ECONNREFUSED|secret|10\.0\.0\.5/);
  });

  it('GET /health/ready answers 503 when storage is down', async () => {
    vi.spyOn(app.get(StorageService), 'ping').mockRejectedValue(
      new Error('s3 down'),
    );
    const res = await get('/health/ready');
    expect(res.statusCode).toBe(503);
    expect(res.json()).toMatchObject({
      checks: { database: 'up', storage: 'down' },
    });
  });

  it('health endpoints are public', async () => {
    expect((await get('/health')).statusCode).toBe(200);
    expect((await get('/health/ready')).statusCode).toBe(200);
  });
});
