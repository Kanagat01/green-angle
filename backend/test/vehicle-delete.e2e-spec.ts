import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  randomVin,
  stepEvidence,
} from './helpers.js';

interface Card {
  id: string;
  vin: string | null;
  requestId: string | null;
}

describe('Vehicle deletion (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '', individual: '' };

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    token: string | null,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload,
    });

  /** Машина подборщика на шаге с файлом: у неё есть вложение, журнал и (по желанию) заявка. */
  const makeVehicle = async (vin = randomVin()) => {
    const created = await call('POST', '/admin/vehicles', tokens.admin, {
      title: `Delete me ${fx.tag}`,
      vin,
      clientId: fx.broker.clientId,
      startStep: 1,
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<Card>().id;
    const moved = await call(
      'POST',
      `/admin/vehicles/${id}/status`,
      tokens.admin,
      {
        step: 2,
        ...(await stepEvidence(app, fx.admin.id, 2)),
      },
    );
    expect(moved.statusCode).toBe(200);
    return { id, vin };
  };

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    fx = await createFixtures(prisma);
    tokens.admin = await accessTokenFor(app, fx.admin.email);
    tokens.broker = await accessTokenFor(app, fx.broker.email);
    tokens.individual = await accessTokenFor(app, fx.individual.email);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  it('hides the vehicle from the owner and from managers everywhere', async () => {
    const { id } = await makeVehicle();
    const before = (
      await call('GET', '/vehicles?limit=200', tokens.broker)
    ).json<{ items: Card[]; counts: { all: number } }>();
    expect(before.items.some((v) => v.id === id)).toBe(true);

    expect(
      (await call('DELETE', `/admin/vehicles/${id}`, tokens.admin)).statusCode,
    ).toBe(204);

    for (const token of [tokens.broker, tokens.admin]) {
      expect((await call('GET', `/vehicles/${id}`, token)).statusCode).toBe(
        404,
      );
    }
    const after = (
      await call('GET', '/vehicles?limit=200', tokens.broker)
    ).json<{ items: Card[]; counts: { all: number; active: number } }>();
    expect(after.items.some((v) => v.id === id)).toBe(false);
    expect(after.counts.all).toBe(before.counts.all - 1);
    const adminList = (
      await call('GET', '/admin/vehicles?limit=200', tokens.admin)
    ).json<{ items: Card[] }>();
    expect(adminList.items.some((v) => v.id === id)).toBe(false);
  });

  it('keeps the immutable journal, drops attachments with their files and frees the VIN', async () => {
    const { id, vin } = await makeVehicle();
    const stored = await prisma.attachment.findMany({
      where: { vehicleStep: { vehicleId: id } },
      select: { key: true },
    });
    expect(stored).toHaveLength(1);
    const storage = app.get(StorageService);
    expect(await storage.head(stored[0].key)).not.toBeNull();

    await call('DELETE', `/admin/vehicles/${id}`, tokens.admin);

    expect(
      await prisma.attachment.count({
        where: { vehicleStep: { vehicleId: id } },
      }),
    ).toBe(0);
    expect(await storage.head(stored[0].key)).toBeNull();
    expect(
      await prisma.vehicleStatusLog.count({ where: { vehicleId: id } }),
    ).toBe(2);
    const row = await prisma.vehicle.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ vin: null, deletedVin: vin });
    expect(row.deletedAt).toBeInstanceOf(Date);

    // тот же VIN можно завести заново
    const again = await call('POST', '/admin/vehicles', tokens.admin, {
      title: `Again ${fx.tag}`,
      vin,
      clientId: fx.broker.clientId,
      startStep: 1,
    });
    expect(again.statusCode).toBe(201);
  });

  it('closes every manager action on a deleted vehicle', async () => {
    const { id } = await makeVehicle();
    await call('DELETE', `/admin/vehicles/${id}`, tokens.admin);

    expect(
      (await call('DELETE', `/admin/vehicles/${id}`, tokens.admin)).statusCode,
    ).toBe(404);
    expect(
      (
        await call('PATCH', `/admin/vehicles/${id}`, tokens.admin, {
          title: 'x',
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('POST', `/admin/vehicles/${id}/status`, tokens.admin, {
          step: 5,
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await call('PATCH', `/vehicles/${id}/notifications`, tokens.broker, {
          enabled: false,
        })
      ).statusCode,
    ).toBe(404);
  });

  it('unlinks the request, keeps it approved and writes a system line into the dialog', async () => {
    const created = await call('POST', '/requests', tokens.broker, {
      title: `Linked ${fx.tag}`,
    });
    const requestId = created.json<{ id: string }>().id;
    const approved = await call(
      'POST',
      `/admin/requests/${requestId}/approve`,
      tokens.admin,
    );
    const vehicleId = approved.json<{ vehicle: { id: string } }>().vehicle.id;

    await call('DELETE', `/admin/vehicles/${vehicleId}`, tokens.admin);

    const request = (
      await call('GET', `/requests/${requestId}`, tokens.broker)
    ).json<{
      status: string;
      vehicleId: string | null;
    }>();
    expect(request).toMatchObject({ status: 'APPROVED', vehicleId: null });
    const messages = (
      await call('GET', `/requests/${requestId}/messages`, tokens.broker)
    ).json<{
      items: { type: string; text: string }[];
    }>();
    expect(messages.items.at(-1)).toMatchObject({
      type: 'SYSTEM',
      text: 'Менеджер удалил машину.',
    });
  });

  it('does not count deleted vehicles for the client in the manager screen', async () => {
    const { id } = await makeVehicle();
    const count = async () =>
      (
        await call('GET', `/admin/clients/${fx.broker.clientId}`, tokens.admin)
      ).json<{ vehiclesCount: number }>().vehiclesCount;
    const before = await count();
    await call('DELETE', `/admin/vehicles/${id}`, tokens.admin);
    expect(await count()).toBe(before - 1);
  });

  it('is for managers only', async () => {
    const { id } = await makeVehicle();
    expect(
      (await call('DELETE', `/admin/vehicles/${id}`, tokens.broker)).statusCode,
    ).toBe(403);
    expect(
      (await call('DELETE', `/admin/vehicles/${id}`, tokens.individual))
        .statusCode,
    ).toBe(403);
    expect(
      (await call('DELETE', `/admin/vehicles/${id}`, null)).statusCode,
    ).toBe(401);
    expect(
      (await call('GET', `/vehicles/${id}`, tokens.broker)).statusCode,
    ).toBe(200);
  });

  it('rejects an id that is not a UUID', async () => {
    expect(
      (await call('DELETE', '/admin/vehicles/nope', tokens.admin)).statusCode,
    ).toBe(400);
  });
});
