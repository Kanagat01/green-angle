import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter } from '../src/app.setup.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  randomVin,
} from './helpers.js';

// Выполняется до импортов, поэтому ConfigModule видит значения при валидации env
vi.hoisted(() => {
  process.env.RATE_LIMIT_VIN_CHECK_MAX = '4';
  process.env.RATE_LIMIT_WINDOW_SEC = '60';
  process.env.TRUST_PROXY = 'true';
});

describe('Public VIN check (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  let adminToken: string;

  beforeEach(async () => {
    app = await createApp({
      adapter: createFastifyAdapter({ LOG_LEVEL: 'fatal', TRUST_PROXY: true }),
    });
    prisma = app.get(PrismaService);
    fx ??= await createFixtures(prisma);
    adminToken = await accessTokenFor(app, fx.admin.email);
  });

  afterEach(() => app.close());

  afterAll(async () => {
    const cleanupApp = await createApp();
    await fx.cleanup();
    await cleanupApp.close();
  });

  const check = (vin: string, ip = '10.1.0.1') =>
    app.inject({
      method: 'GET',
      url: `/api/v1/public/vehicle-status?vin=${encodeURIComponent(vin)}`,
      headers: { 'x-forwarded-for': ip },
    });

  const make = async (step: number) => {
    const vin = randomVin();
    const res = await app.inject({
      method: 'POST',
      url: '/api/v1/admin/vehicles',
      headers: { authorization: `Bearer ${adminToken}` },
      payload: {
        title: `Public ${fx.tag}`,
        vin,
        clientId: fx.broker.clientId,
        startStep: step,
      },
    });
    expect(res.statusCode).toBe(201);
    return { vin, id: res.json<{ id: string }>().id };
  };

  it('answers without a token with the model, the step and the progress only', async () => {
    const { vin } = await make(9);
    const res = await check(vin);
    expect(res.statusCode).toBe(200);
    const { updatedAt, ...rest } = res.json<{ updatedAt: string }>();
    expect(new Date(updatedAt).getTime()).not.toBeNaN();
    expect(rest).toEqual({
      title: `Public ${fx.tag}`,
      currentStep: 9,
      currentStepTitle: 'Прибыла на СВХ, ожидает тамож. оформление',
      totalSteps: 13,
      progress: 9 / 13,
    });
  });

  it('accepts lower case and surrounding spaces', async () => {
    const { vin } = await make(3);
    const res = await check(`  ${vin.toLowerCase()} `);
    expect(res.statusCode).toBe(200);
    expect(res.json<{ currentStep: number }>().currentStep).toBe(3);
  });

  it('answers 404 for an unknown VIN and 400 for a malformed one', async () => {
    expect((await check(randomVin())).statusCode).toBe(404);
    // у каждого запроса свой адрес, чтобы лимит не мешал проверке формата
    const bad = ['', 'SHORT', 'LVSHCAMB5RE07773!', 'LVSHCAMB5RE0777345'];
    for (const [i, vin] of bad.entries()) {
      expect((await check(vin, `10.2.0.${i}`)).statusCode, vin).toBe(400);
    }
  });

  it('does not find a deleted vehicle', async () => {
    const { vin, id } = await make(5);
    expect((await check(vin)).statusCode).toBe(200);
    await app.inject({
      method: 'DELETE',
      url: `/api/v1/admin/vehicles/${id}`,
      headers: { authorization: `Bearer ${adminToken}` },
    });
    expect((await check(vin)).statusCode).toBe(404);
  });

  it('limits checks per IP, counting misses too, and tells when to retry', async () => {
    for (let i = 0; i < 4; i++) {
      expect((await check(randomVin())).statusCode).toBe(404);
    }
    const blocked = await check(randomVin());
    expect(blocked.statusCode).toBe(429);
    expect(Number(blocked.headers['retry-after'])).toBeGreaterThan(0);
    // другой адрес не затронут
    expect((await check(randomVin(), '10.1.0.2')).statusCode).toBe(404);
  });

  it('does not slow down the rest of the API for the blocked IP', async () => {
    for (let i = 0; i < 5; i++) await check(randomVin(), '10.1.0.3');
    const res = await app.inject({
      method: 'GET',
      url: '/api/v1/health',
      headers: { 'x-forwarded-for': '10.1.0.3' },
    });
    expect(res.statusCode).toBe(200);
  });
});
