import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  randomVin,
} from './helpers.js';

// Выполняется до импортов, поэтому ConfigModule видит флаг при валидации env
vi.hoisted(() => {
  process.env.STRICT_ATTACHMENTS = 'true';
});

describe('Strict attachments mode (STRICT_ATTACHMENTS=true)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  let adminToken: string;

  const post = (url: string, payload: object) =>
    app.inject({
      method: 'POST',
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${adminToken}` },
      payload,
    });

  async function newVehicle(startStep: number) {
    const res = await post('/admin/vehicles', {
      title: 'Strict car',
      vin: randomVin(),
      clientId: fx.broker.clientId,
      startStep,
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    fx = await createFixtures(prisma);
    adminToken = await accessTokenFor(app, fx.admin.email);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  it('allows moving past steps that expect no attachment', async () => {
    const id = await newVehicle(1);
    // шаг 1 вложений не ждёт
    expect(
      (await post(`/admin/vehicles/${id}/status`, { step: 2 })).statusCode,
    ).toBe(200);
  });

  it('blocks moving past a step whose expected attachment is missing', async () => {
    const id = await newVehicle(2);
    const res = await post(`/admin/vehicles/${id}/status`, { step: 3 });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toContain('2');

    // статус и журнал не изменились
    const vehicle = await prisma.vehicle.findUniqueOrThrow({ where: { id } });
    expect(vehicle.currentStep).toBe(2);
    expect(
      await prisma.vehicleStatusLog.count({ where: { vehicleId: id } }),
    ).toBe(1);
  });

  it('lists every step with a missing attachment', async () => {
    const id = await newVehicle(1);
    const res = await post(`/admin/vehicles/${id}/status`, { step: 5 });
    expect(res.statusCode).toBe(400);
    expect(res.json<{ message: string }>().message).toContain('2, 3, 4');
  });

  it('allows moving backward regardless of attachments', async () => {
    const id = await newVehicle(6);
    expect(
      (await post(`/admin/vehicles/${id}/status`, { step: 2 })).statusCode,
    ).toBe(200);
  });

  it('counts a declaration number supplied with the move as satisfying step 10', async () => {
    // машина сразу на шаге 10: шаги до него «пройдены» при создании, вложений у них нет
    const id = await newVehicle(10);
    const blocked = await post(`/admin/vehicles/${id}/status`, { step: 11 });
    expect(blocked.statusCode).toBe(400);
    expect(blocked.json<{ message: string }>().message).toContain('10');

    // номер декларации сам по себе закрывает требование шага 10, но остальные шаги — нет
    const withNumber = await post(`/admin/vehicles/${id}/status`, {
      step: 11,
      declarationNumber: 'N-1',
    });
    expect(withNumber.statusCode).toBe(400);
    expect(withNumber.json<{ message: string }>().message).not.toContain('10');
  });
});
