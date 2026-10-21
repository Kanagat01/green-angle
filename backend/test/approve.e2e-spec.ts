import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  randomVin,
  stepEvidence,
} from './helpers.js';

interface RequestView {
  id: string;
  title: string;
  status: 'NEW' | 'IN_DIALOG' | 'APPROVED';
  vehicleId: string | null;
  client: { id: string };
}
interface Card {
  id: string;
  title: string;
  vin: string | null;
  currentStep: number;
  client: { id: string };
  steps: { step: number; state: string }[];
}
interface ApproveResult {
  request: RequestView;
  vehicle: Card;
}

describe('Request approval (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '', otherBroker: '', individual: '' };

  const call = (
    method: 'GET' | 'POST' | 'PATCH',
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

  async function newRequest(
    token = tokens.broker,
    title = `Approve ${fx.tag}`,
  ) {
    const res = await call('POST', '/requests', token, {
      title,
      yearFrom: 2023,
    });
    expect(res.statusCode).toBe(201);
    const id = res.json<RequestView>().id;
    // Этот набор проверяет одобрение и диалог, а не первое сообщение заявки (оно в request-first-message)
    await prisma.message.deleteMany({ where: { requestId: id } });
    return id;
  }
  const approve = (id: string, token: string | null = tokens.admin) =>
    call('POST', `/admin/requests/${id}/approve`, token);
  const vehiclesOf = (clientId: string) =>
    prisma.vehicle.findMany({ where: { clientId } });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    fx = await createFixtures(prisma);
    tokens.admin = await accessTokenFor(app, fx.admin.email);
    tokens.broker = await accessTokenFor(app, fx.broker.email);
    tokens.otherBroker = await accessTokenFor(app, fx.otherBroker.email);
    tokens.individual = await accessTokenFor(app, fx.individual.email);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  describe('approving', () => {
    it('approves a NEW request and creates a vehicle at step 1 without VIN', async () => {
      const title = `Chery Tiggo 8 Pro ${fx.tag}`;
      const id = await newRequest(tokens.broker, title);
      const before = (await vehiclesOf(fx.broker.clientId)).length;

      const res = await approve(id);
      expect(res.statusCode).toBe(200);
      const { request, vehicle } = res.json<ApproveResult>();

      expect(request).toMatchObject({
        id,
        status: 'APPROVED',
        vehicleId: vehicle.id,
      });
      expect(vehicle).toMatchObject({
        title,
        vin: null,
        currentStep: 1,
        client: { id: fx.broker.clientId },
      });
      expect(vehicle.steps).toHaveLength(13);
      expect(vehicle.steps[0].state).toBe('CURRENT');
      expect(vehicle.steps.slice(1).every((s) => s.state === 'PENDING')).toBe(
        true,
      );
      expect(await vehiclesOf(fx.broker.clientId)).toHaveLength(before + 1);

      // в журнал статусов попала запись о создании: кто одобрил
      const logs = await prisma.vehicleStatusLog.findMany({
        where: { vehicleId: vehicle.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        fromStep: null,
        toStep: 1,
        changedById: fx.admin.id,
      });
    });

    it('approves a request that is already IN_DIALOG', async () => {
      const id = await newRequest();
      await call('POST', `/requests/${id}/messages`, tokens.admin, {
        text: 'Подберём',
      });
      expect(
        (await call('GET', `/requests/${id}`, tokens.admin)).json<RequestView>()
          .status,
      ).toBe('IN_DIALOG');

      const res = await approve(id);
      expect(res.statusCode).toBe(200);
      expect(res.json<ApproveResult>().request.status).toBe('APPROVED');
    });

    it('creates the vehicle for the client of the request, not for the approver', async () => {
      const id = await newRequest(tokens.individual);
      const { vehicle } = (await approve(id)).json<ApproveResult>();
      expect(vehicle.client.id).toBe(fx.individual.clientId);
    });

    it('makes the vehicle visible to its client only', async () => {
      const id = await newRequest();
      const { vehicle } = (await approve(id)).json<ApproveResult>();

      const own = await call('GET', `/vehicles/${vehicle.id}`, tokens.broker);
      expect(own.statusCode).toBe(200);
      expect(own.json<Card>()).toMatchObject({ vin: null, currentStep: 1 });

      for (const who of ['otherBroker', 'individual'] as const) {
        expect(
          (await call('GET', `/vehicles/${vehicle.id}`, tokens[who]))
            .statusCode,
        ).toBe(404);
      }
      // клиент видит и ссылку на машину в самой заявке
      const request = (
        await call('GET', `/requests/${id}`, tokens.broker)
      ).json<RequestView>();
      expect(request.vehicleId).toBe(vehicle.id);
    });

    it('lets the admin fill in the VIN afterwards', async () => {
      const id = await newRequest();
      const { vehicle } = (await approve(id)).json<ApproveResult>();

      const vin = randomVin();
      const patched = await call(
        'PATCH',
        `/admin/vehicles/${vehicle.id}`,
        tokens.admin,
        { vin },
      );
      expect(patched.statusCode).toBe(200);
      expect(patched.json<Card>().vin).toBe(vin);

      // и дальше с машиной работают как с обычной: смена статуса, поиск по VIN
      const moved = await call(
        'POST',
        `/admin/vehicles/${vehicle.id}/status`,
        tokens.admin,
        { step: 2, ...(await stepEvidence(app, fx.admin.id, 2)) },
      );
      expect(moved.statusCode).toBe(200);
      const found = await call(
        'GET',
        `/admin/vehicles?vin=${vin.slice(3, 10)}`,
        tokens.admin,
      );
      expect(found.json<{ items: Card[] }>().items.map((v) => v.id)).toContain(
        vehicle.id,
      );
    });

    it('does not touch other requests or clients', async () => {
      const target = await newRequest();
      const bystander = await newRequest();
      const otherClientRequest = await newRequest(tokens.otherBroker);
      const otherBefore = await vehiclesOf(fx.otherBroker.clientId);

      await approve(target);

      const statusOf = async (id: string) =>
        (await prisma.request.findUniqueOrThrow({ where: { id } })).status;
      expect(await statusOf(bystander)).toBe('NEW');
      expect(await statusOf(otherClientRequest)).toBe('NEW');
      expect(await vehiclesOf(fx.otherBroker.clientId)).toHaveLength(
        otherBefore.length,
      );
    });
  });

  describe('idempotency and concurrency', () => {
    it('returns the same vehicle on a repeated call and creates no duplicate', async () => {
      const id = await newRequest();
      const first = (await approve(id)).json<ApproveResult>();
      const countAfterFirst = (await vehiclesOf(fx.broker.clientId)).length;

      const second = await approve(id);
      expect(second.statusCode).toBe(200);
      const again = second.json<ApproveResult>();
      expect(again.vehicle.id).toBe(first.vehicle.id);
      expect(again.request).toMatchObject({
        status: 'APPROVED',
        vehicleId: first.vehicle.id,
      });

      expect(await vehiclesOf(fx.broker.clientId)).toHaveLength(
        countAfterFirst,
      );
      expect(
        await prisma.vehicleStatusLog.count({
          where: { vehicleId: first.vehicle.id },
        }),
      ).toBe(1);
    });

    it('does not roll an advanced vehicle back when approved again', async () => {
      const id = await newRequest();
      const { vehicle } = (await approve(id)).json<ApproveResult>();
      await call('POST', `/admin/vehicles/${vehicle.id}/status`, tokens.admin, {
        step: 5,
      });

      const again = (await approve(id)).json<ApproveResult>();
      expect(again.vehicle.id).toBe(vehicle.id);
      expect(again.vehicle.currentStep).toBe(5);
    });

    it('creates exactly one vehicle for many simultaneous approvals', async () => {
      const id = await newRequest();
      const before = (await vehiclesOf(fx.broker.clientId)).length;

      const results = await Promise.all(
        Array.from({ length: 6 }, () => approve(id)),
      );
      expect(results.map((r) => r.statusCode)).toEqual(Array(6).fill(200));
      const vehicleIds = new Set(
        results.map((r) => r.json<ApproveResult>().vehicle.id),
      );
      expect(vehicleIds.size).toBe(1);

      expect(await vehiclesOf(fx.broker.clientId)).toHaveLength(before + 1);
      expect(
        await prisma.vehicleStatusLog.count({
          where: { vehicleId: [...vehicleIds][0] },
        }),
      ).toBe(1);
    });

    it('repairs a request that is APPROVED but has no vehicle', async () => {
      const id = await newRequest();
      await prisma.request.update({
        where: { id },
        data: { status: 'APPROVED' },
      });

      const res = await approve(id);
      expect(res.statusCode).toBe(200);
      const { request, vehicle } = res.json<ApproveResult>();
      expect(request.vehicleId).toBe(vehicle.id);
    });

    it('gives each approval its own vehicle for different requests', async () => {
      const a = await newRequest();
      const b = await newRequest();
      const va = (await approve(a)).json<ApproveResult>().vehicle.id;
      const vb = (await approve(b)).json<ApproveResult>().vehicle.id;
      expect(va).not.toBe(vb);
    });
  });

  describe('dialog after approval', () => {
    it('becomes read-only but stays readable', async () => {
      const id = await newRequest();
      await call('POST', `/requests/${id}/messages`, tokens.broker, {
        text: 'до',
      });
      await approve(id);

      for (const token of [tokens.broker, tokens.admin]) {
        const res = await call('POST', `/requests/${id}/messages`, token, {
          text: 'после',
        });
        expect(res.statusCode).toBe(409);
      }
      const list = await call('GET', `/requests/${id}/messages`, tokens.broker);
      expect(list.statusCode).toBe(200);
      // кроме «до» в ленте только служебная строка об одобрении
      const items = list.json<{ items: { type: string }[] }>().items;
      expect(items.filter((m) => m.type !== 'SYSTEM')).toHaveLength(1);
      expect(items.filter((m) => m.type === 'SYSTEM')).toHaveLength(1);
    });

    it('serializes approval with message posting: no message sneaks in after APPROVED', async () => {
      const id = await newRequest();
      const results = await Promise.all([
        approve(id),
        ...Array.from({ length: 6 }, (_, i) =>
          call('POST', `/requests/${id}/messages`, tokens.broker, {
            text: `гонка ${i}`,
          }),
        ),
      ]);
      expect(results[0].statusCode).toBe(200);
      for (const r of results.slice(1))
        expect([201, 409]).toContain(r.statusCode);

      // каждое принятое (201) сообщение сохранено, а отклонённые (409) — нет
      const accepted = results
        .slice(1)
        .filter((r) => r.statusCode === 201).length;
      expect(
        await prisma.message.count({
          where: { requestId: id, type: { not: 'SYSTEM' } },
        }),
      ).toBe(accepted);

      // после одобрения писать уже нельзя
      expect(
        (
          await call('POST', `/requests/${id}/messages`, tokens.broker, {
            text: 'поздно',
          })
        ).statusCode,
      ).toBe(409);
    });
  });

  describe('access control', () => {
    it.each(['broker', 'individual'] as const)(
      'forbids %s from approving',
      async (who) => {
        const id = await newRequest(
          who === 'broker' ? tokens.broker : tokens.individual,
        );
        expect((await approve(id, tokens[who])).statusCode).toBe(403);
        expect(
          (await prisma.request.findUniqueOrThrow({ where: { id } })).status,
        ).toBe('NEW');
      },
    );

    it('requires authentication', async () => {
      const id = await newRequest();
      expect((await approve(id, null)).statusCode).toBe(401);
    });

    it('returns 404 for an unknown request and 400 for a malformed id', async () => {
      expect(
        (await approve('00000000-0000-4000-8000-000000000000')).statusCode,
      ).toBe(404);
      expect((await approve('not-a-uuid')).statusCode).toBe(400);
    });
  });
});
