import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  randomVin,
} from './helpers.js';

interface Step {
  step: number;
  title: string;
  state: 'COMPLETED' | 'CURRENT' | 'PENDING';
  completedAt: string | null;
  expectedAttachment: string | null;
  declarationNumber: string | null;
  attachments: { id: string; url: string; kind: string }[];
}
interface Card {
  id: string;
  title: string;
  vin: string | null;
  currentStep: number;
  currentStepTitle: string;
  totalSteps: number;
  progress: number;
  client: { id: string; name: string; type: string };
  steps: Step[];
}
interface List {
  items: Card[];
  total: number;
}

const s3Up = await fetch(process.env.S3_ENDPOINT!, {
  signal: AbortSignal.timeout(2000),
})
  .then(() => true)
  .catch(() => false);

describe('Vehicles and statuses (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '', otherBroker: '', individual: '' };
  const s3Keys: string[] = [];

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

  const adminCreate = (payload: object) =>
    call('POST', '/admin/vehicles', tokens.admin, payload);

  /** Создаёт машину админом для существующего клиента. */
  async function createFor(clientId: string, extra: object = {}) {
    const res = await adminCreate({
      title: 'Test car',
      vin: randomVin(),
      clientId,
      ...extra,
    });
    expect(res.statusCode).toBe(201);
    return res.json<Card>();
  }

  const setStatus = (id: string, step: number, extra: object = {}) =>
    call('POST', `/admin/vehicles/${id}/status`, tokens.admin, {
      step,
      ...extra,
    });

  /** Строка состояний шагов: D — завершён, C — текущий, P — ожидает */
  const SYMBOL = { COMPLETED: 'D', CURRENT: 'C', PENDING: 'P' } as const;
  const states = (card: Card) =>
    card.steps.map((s) => SYMBOL[s.state]).join('');

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    fx = await createFixtures(prisma);
    tokens.admin = await accessTokenFor(app, fx.admin.email);
    tokens.broker = await accessTokenFor(app, fx.broker.email);
    tokens.otherBroker = await accessTokenFor(app, fx.otherBroker.email);
    tokens.individual = await accessTokenFor(app, fx.individual.email);
  });

  afterAll(async () => {
    await Promise.all(s3Keys.map((key) => storage.delete(key).catch(() => {})));
    await fx.cleanup();
    await app.close();
  });

  describe('creation (super admin)', () => {
    it('creates a vehicle for a new client at step 1 and logs it', async () => {
      const vin = randomVin();
      const res = await adminCreate({
        title: 'Geely Monjaro, 2024',
        vin: vin.toLowerCase(),
        client: { type: 'COMPANY', name: `New client ${fx.tag}` },
      });
      expect(res.statusCode).toBe(201);
      const card = res.json<Card>();

      expect(card).toMatchObject({
        title: 'Geely Monjaro, 2024',
        vin, // нормализован в верхний регистр
        currentStep: 1,
        totalSteps: 13,
        client: { name: `New client ${fx.tag}`, type: 'COMPANY' },
      });
      expect(card.progress).toBeCloseTo(1 / 13);
      expect(card.steps).toHaveLength(13);
      expect(states(card)).toBe('CPPPPPPPPPPPP');
      expect(card.steps.map((s) => s.step)).toEqual(
        Array.from({ length: 13 }, (_, i) => i + 1),
      );

      const logs = await prisma.vehicleStatusLog.findMany({
        where: { vehicleId: card.id },
      });
      expect(logs).toHaveLength(1);
      expect(logs[0]).toMatchObject({
        fromStep: null,
        toStep: 1,
        changedById: fx.admin.id,
      });
    });

    it('marks all steps before the start step as completed', async () => {
      const card = await createFor(fx.broker.clientId, { startStep: 9 });
      expect(card.currentStep).toBe(9);
      expect(card.currentStepTitle).toBe(
        'Прибыла на СВХ, ожидает тамож. оформление',
      );
      expect(states(card)).toBe('DDDDDDDDCPPPP');
      expect(card.progress).toBeCloseTo(9 / 13);
    });

    it('treats step 13 as completed when created at the final step', async () => {
      const card = await createFor(fx.broker.clientId, { startStep: 13 });
      expect(card.steps.every((s) => s.state === 'COMPLETED')).toBe(true);
      expect(card.progress).toBe(1);
    });

    it('requires exactly one of clientId / client', async () => {
      const base = { title: 'X', vin: randomVin() };
      expect((await adminCreate(base)).statusCode).toBe(400);
      expect(
        (
          await adminCreate({
            ...base,
            clientId: fx.broker.clientId,
            client: { type: 'PERSON', name: `Both ${fx.tag}` },
          })
        ).statusCode,
      ).toBe(400);
    });

    it.each(['SHORT', 'LB37622Z0RX00000I', 'LB37622Z0RX0000012', ''])(
      'rejects an invalid VIN "%s"',
      async (vin) => {
        const res = await adminCreate({
          title: 'X',
          vin,
          clientId: fx.broker.clientId,
        });
        expect(res.statusCode).toBe(400);
      },
    );

    it('rejects an unknown client with 404', async () => {
      const res = await adminCreate({
        title: 'X',
        vin: randomVin(),
        clientId: '00000000-0000-4000-8000-000000000000',
      });
      expect(res.statusCode).toBe(404);
    });

    it('rejects a duplicate VIN with 409 and does not leave a new client behind', async () => {
      const vin = randomVin();
      await createFor(fx.broker.clientId, { vin });

      const res = await adminCreate({
        title: 'Dup',
        vin,
        client: { type: 'PERSON', name: `Orphan ${fx.tag}` },
      });
      expect(res.statusCode).toBe(409);
      expect(
        await prisma.client.count({ where: { name: `Orphan ${fx.tag}` } }),
      ).toBe(0);
    });

    it.each(['broker', 'individual'] as const)(
      'forbids %s from admin vehicle routes',
      async (who) => {
        const body = {
          title: 'X',
          vin: randomVin(),
          clientId: fx.broker.clientId,
        };
        expect(
          (await call('POST', '/admin/vehicles', tokens[who], body)).statusCode,
        ).toBe(403);
        expect(
          (await call('GET', '/admin/vehicles', tokens[who])).statusCode,
        ).toBe(403);
      },
    );

    it('requires authentication', async () => {
      expect((await call('GET', '/admin/vehicles', null)).statusCode).toBe(401);
      expect((await call('GET', '/vehicles', null)).statusCode).toBe(401);
    });
  });

  describe('status changes', () => {
    it('moves forward, completes passed steps and writes a log entry', async () => {
      const card = await createFor(fx.broker.clientId);
      const res = await setStatus(card.id, 5);
      expect(res.statusCode).toBe(200);
      const updated = res.json<Card>();

      expect(updated.currentStep).toBe(5);
      expect(states(updated)).toBe('DDDDCPPPPPPPP');

      const logs = await prisma.vehicleStatusLog.findMany({
        where: { vehicleId: card.id },
        orderBy: { changedAt: 'asc' },
      });
      expect(logs.map((l) => [l.fromStep, l.toStep])).toEqual([
        [null, 1],
        [1, 5],
      ]);
      expect(logs[1].changedById).toBe(fx.admin.id);
    });

    it('moves backward, reopening later steps but keeping earlier completion dates', async () => {
      const card = await createFor(fx.broker.clientId, { startStep: 8 });
      const before = (
        await call('GET', `/vehicles/${card.id}`, tokens.admin)
      ).json<Card>();

      const res = await setStatus(card.id, 3);
      expect(res.statusCode).toBe(200);
      const updated = res.json<Card>();

      expect(updated.currentStep).toBe(3);
      expect(states(updated)).toBe('DDCPPPPPPPPPP');
      expect(updated.steps.slice(2).every((s) => s.completedAt === null)).toBe(
        true,
      );
      // даты завершения шагов 1–2 не перезаписаны
      expect(updated.steps[0].completedAt).toBe(before.steps[0].completedAt);
      expect(updated.steps[1].completedAt).toBe(before.steps[1].completedAt);

      const last = await prisma.vehicleStatusLog.findFirst({
        where: { vehicleId: card.id },
        orderBy: { changedAt: 'desc' },
      });
      expect(last).toMatchObject({
        fromStep: 8,
        toStep: 3,
        changedById: fx.admin.id,
      });
    });

    it('completes step 13 when the vehicle reaches the final step', async () => {
      const card = await createFor(fx.broker.clientId, { startStep: 12 });
      const updated = (await setStatus(card.id, 13)).json<Card>();
      expect(updated.steps.every((s) => s.state === 'COMPLETED')).toBe(true);
      expect(updated.progress).toBe(1);
    });

    it('rejects moving to the same step', async () => {
      const card = await createFor(fx.broker.clientId, { startStep: 4 });
      expect((await setStatus(card.id, 4)).statusCode).toBe(400);
    });

    it.each([0, 14, 2.5, 'x'])('rejects an invalid step %s', async (step) => {
      const card = await createFor(fx.broker.clientId);
      const res = await call(
        'POST',
        `/admin/vehicles/${card.id}/status`,
        tokens.admin,
        { step },
      );
      expect(res.statusCode).toBe(400);
    });

    it('returns 404 for an unknown vehicle', async () => {
      const res = await setStatus('00000000-0000-4000-8000-000000000000', 2);
      expect(res.statusCode).toBe(404);
    });

    it('stores the declaration number from step 10 and logs it', async () => {
      const card = await createFor(fx.broker.clientId, { startStep: 9 });
      const number = '10702070/181024/5012345';

      const res = await setStatus(card.id, 10, { declarationNumber: number });
      expect(res.statusCode).toBe(200);
      const updated = res.json<Card>();
      expect(updated.steps[9].declarationNumber).toBe(number);
      expect(updated.steps[9].expectedAttachment).toBe('DECLARATION_NUMBER');
      // номер виден только на шаге 10
      expect(updated.steps.filter((s) => s.declarationNumber).length).toBe(1);

      const last = await prisma.vehicleStatusLog.findFirst({
        where: { vehicleId: card.id },
        orderBy: { changedAt: 'desc' },
      });
      expect(last).toMatchObject({ toStep: 10, declarationNumber: number });
    });

    it('allows adding the declaration number later without changing the step', async () => {
      const card = await createFor(fx.broker.clientId, { startStep: 10 });
      const res = await setStatus(card.id, 10, { declarationNumber: 'LATE-1' });
      expect(res.statusCode).toBe(200);
      expect(res.json<Card>().steps[9].declarationNumber).toBe('LATE-1');
      expect(
        await prisma.vehicleStatusLog.count({ where: { vehicleId: card.id } }),
      ).toBe(2);
    });

    it('rejects a declaration number for a step before 10', async () => {
      const card = await createFor(fx.broker.clientId);
      const res = await setStatus(card.id, 5, { declarationNumber: 'X-1' });
      expect(res.statusCode).toBe(400);
    });

    it('does not block a status change when expected attachments are missing', async () => {
      const card = await createFor(fx.broker.clientId);
      // шаги 2–4 ждут вложений, но их нет — статус всё равно меняется
      expect((await setStatus(card.id, 5)).statusCode).toBe(200);
    });

    it('keeps a consistent log chain under concurrent changes', async () => {
      const card = await createFor(fx.broker.clientId);
      const results = await Promise.all(
        [3, 4, 5, 6].map((step) => setStatus(card.id, step)),
      );
      for (const r of results) expect([200, 400, 409]).toContain(r.statusCode);

      const logs = await prisma.vehicleStatusLog.findMany({
        where: { vehicleId: card.id },
        orderBy: { changedAt: 'asc' },
      });
      // каждая запись начинается там, где закончилась предыдущая
      for (let i = 1; i < logs.length; i++) {
        expect(logs[i].fromStep).toBe(logs[i - 1].toStep);
      }
      const vehicle = await prisma.vehicle.findUniqueOrThrow({
        where: { id: card.id },
      });
      expect(vehicle.currentStep).toBe(logs[logs.length - 1].toStep);
    });
  });

  describe('updating a vehicle', () => {
    async function withoutVin() {
      return prisma.vehicle.create({
        data: {
          clientId: fx.broker.clientId,
          title: 'From request',
          steps: {
            create: Array.from({ length: 13 }, (_, i) => ({ step: i + 1 })),
          },
        },
      });
    }

    it('fills in the VIN of a vehicle created without one', async () => {
      const v = await withoutVin();
      const vin = randomVin();
      const res = await call('PATCH', `/admin/vehicles/${v.id}`, tokens.admin, {
        vin: vin.toLowerCase(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<Card>().vin).toBe(vin);
    });

    it('updates the title', async () => {
      const card = await createFor(fx.broker.clientId);
      const res = await call(
        'PATCH',
        `/admin/vehicles/${card.id}`,
        tokens.admin,
        {
          title: 'Renamed',
        },
      );
      expect(res.json<Card>().title).toBe('Renamed');
    });

    it('rejects a VIN that is already used with 409', async () => {
      const taken = await createFor(fx.broker.clientId);
      const v = await withoutVin();
      const res = await call('PATCH', `/admin/vehicles/${v.id}`, tokens.admin, {
        vin: taken.vin,
      });
      expect(res.statusCode).toBe(409);
    });

    it('rejects an invalid VIN and an empty body', async () => {
      const card = await createFor(fx.broker.clientId);
      const url = `/admin/vehicles/${card.id}`;
      expect(
        (await call('PATCH', url, tokens.admin, { vin: 'bad' })).statusCode,
      ).toBe(400);
      expect((await call('PATCH', url, tokens.admin, {})).statusCode).toBe(400);
    });

    it('returns 404 for an unknown vehicle and 403 for non-admins', async () => {
      const unknown = '/admin/vehicles/00000000-0000-4000-8000-000000000000';
      expect(
        (await call('PATCH', unknown, tokens.admin, { title: 'X' })).statusCode,
      ).toBe(404);
      const card = await createFor(fx.broker.clientId);
      expect(
        (
          await call('PATCH', `/admin/vehicles/${card.id}`, tokens.broker, {
            title: 'X',
          })
        ).statusCode,
      ).toBe(403);
    });
  });

  describe('client scope and search', () => {
    let brokerCar: Card;
    let otherCar: Card;
    let personCar: Card;

    beforeAll(async () => {
      brokerCar = await createFor(fx.broker.clientId, { startStep: 2 });
      otherCar = await createFor(fx.otherBroker.clientId, { startStep: 5 });
      personCar = await createFor(fx.individual.clientId, { startStep: 9 });
    });

    const ids = async (url: string, token: string) =>
      (await call('GET', url, token)).json<List>().items.map((v) => v.id);

    it('broker sees only its own vehicles', async () => {
      const list = await ids('/vehicles', tokens.broker);
      expect(list).toEqual(
        expect.arrayContaining([fx.broker.vehicleId, brokerCar.id]),
      );
      expect(list).not.toContain(otherCar.id);
      expect(list).not.toContain(personCar.id);
      expect(list).not.toContain(fx.otherBroker.vehicleId);
    });

    it('individual does not see company vehicles', async () => {
      const list = await ids('/vehicles', tokens.individual);
      expect(list).toEqual(
        expect.arrayContaining([fx.individual.vehicleId, personCar.id]),
      );
      expect(list).not.toContain(brokerCar.id);
      expect(list).not.toContain(otherCar.id);
    });

    it('ignores a foreign clientId in the client query', async () => {
      const list = await ids(
        `/vehicles?clientId=${fx.otherBroker.clientId}`,
        tokens.broker,
      );
      expect(list).toContain(brokerCar.id);
      expect(list).not.toContain(otherCar.id);
    });

    it('admin sees vehicles of all clients', async () => {
      const list = await ids('/vehicles?limit=200', tokens.admin);
      expect(list).toEqual(
        expect.arrayContaining([brokerCar.id, otherCar.id, personCar.id]),
      );
    });

    it('returns the card with 13 steps for the owner and for admin', async () => {
      for (const token of [tokens.broker, tokens.admin]) {
        const res = await call('GET', `/vehicles/${brokerCar.id}`, token);
        expect(res.statusCode).toBe(200);
        const card = res.json<Card>();
        expect(card.steps).toHaveLength(13);
        expect(card.steps[0].title).toBe('Ожидает оплату');
        expect(card.steps[1].expectedAttachment).toBe('FILE');
        expect(card.steps[1].state).toBe('CURRENT');
      }
    });

    it('returns 404 (not 403) for another client vehicle', async () => {
      for (const [token, car] of [
        [tokens.broker, otherCar],
        [tokens.broker, personCar],
        [tokens.individual, brokerCar],
        [tokens.otherBroker, brokerCar],
      ] as const) {
        expect(
          (await call('GET', `/vehicles/${car.id}`, token)).statusCode,
        ).toBe(404);
      }
    });

    it('returns 400 for a malformed id', async () => {
      expect(
        (await call('GET', '/vehicles/not-a-uuid', tokens.broker)).statusCode,
      ).toBe(400);
    });

    it('searches by VIN substring, case-insensitively', async () => {
      const part = brokerCar.vin!.slice(4, 12).toLowerCase();
      const res = await call(
        'GET',
        `/admin/vehicles?vin=${part}`,
        tokens.admin,
      );
      const found = res.json<List>().items.map((v) => v.id);
      expect(found).toContain(brokerCar.id);
      expect(found).not.toContain(otherCar.id);
    });

    it('filters by clientId and by step', async () => {
      const byClient = await ids(
        `/admin/vehicles?clientId=${fx.otherBroker.clientId}`,
        tokens.admin,
      );
      expect(byClient).toContain(otherCar.id);
      expect(byClient).not.toContain(brokerCar.id);

      const byStep = await ids(
        `/admin/vehicles?step=9&clientId=${fx.individual.clientId}`,
        tokens.admin,
      );
      expect(byStep).toEqual([personCar.id]);
    });

    it('paginates and reports the total', async () => {
      const url = `/admin/vehicles?clientId=${fx.broker.clientId}`;
      const all = (await call('GET', url, tokens.admin)).json<List>();
      expect(all.total).toBeGreaterThanOrEqual(2);

      const first = (
        await call('GET', `${url}&limit=1&offset=0`, tokens.admin)
      ).json<List>();
      const second = (
        await call('GET', `${url}&limit=1&offset=1`, tokens.admin)
      ).json<List>();
      expect(first.items).toHaveLength(1);
      expect(second.items).toHaveLength(1);
      expect(first.items[0].id).not.toBe(second.items[0].id);
      expect(first.total).toBe(all.total);
    });

    it('validates query parameters', async () => {
      expect(
        (await call('GET', '/admin/vehicles?step=14', tokens.admin)).statusCode,
      ).toBe(400);
      expect(
        (await call('GET', '/vehicles?limit=0', tokens.broker)).statusCode,
      ).toBe(400);
      expect(
        (await call('GET', '/vehicles?limit=201', tokens.broker)).statusCode,
      ).toBe(400);
    });
  });

  describe.runIf(s3Up || !!process.env.CI)('step attachments (real S3)', () => {
    /** presign через API → PUT в S3 → ключ */
    async function uploadAs(
      token: string,
      kind: string,
      mime: string,
      bytes: Uint8Array,
    ) {
      const res = await call('POST', '/uploads/presign', token, {
        kind,
        mime,
        size: bytes.length,
      });
      expect(res.statusCode).toBe(200);
      const t = res.json<{
        key: string;
        uploadUrl: string;
        headers: Record<string, string>;
      }>();
      s3Keys.push(t.key);
      const put = await fetch(t.uploadUrl, {
        method: 'PUT',
        body: bytes as BodyInit,
        headers: t.headers,
      });
      expect(put.ok).toBe(true);
      return t.key;
    }

    it('attaches an uploaded file to a step and exposes it on the card', async () => {
      const card = await createFor(fx.broker.clientId, { startStep: 4 });
      const bytes = new TextEncoder().encode('photo-bytes');
      const key = await uploadAs(tokens.admin, 'PHOTO', 'image/jpeg', bytes);

      const res = await call(
        'POST',
        `/admin/vehicles/${card.id}/steps/3/attachments`,
        tokens.admin,
        {
          key,
          kind: 'PHOTO',
        },
      );
      expect(res.statusCode).toBe(201);
      expect(res.json()).toMatchObject({
        kind: 'PHOTO',
        mime: 'image/jpeg',
        size: bytes.length,
      });

      // владелец видит вложение на нужном шаге и может его скачать
      const owner = (
        await call('GET', `/vehicles/${card.id}`, tokens.broker)
      ).json<Card>();
      expect(owner.steps[2].attachments).toHaveLength(1);
      expect(owner.steps[1].attachments).toHaveLength(0);
      const download = await fetch(owner.steps[2].attachments[0].url);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);

      // чужой клиент не видит даже саму машину
      expect(
        (await call('GET', `/vehicles/${card.id}`, tokens.otherBroker))
          .statusCode,
      ).toBe(404);
    });

    it("rejects someone else's key and an unknown step", async () => {
      const card = await createFor(fx.broker.clientId);
      const foreignKey = await uploadAs(
        tokens.broker,
        'PHOTO',
        'image/png',
        new Uint8Array(8),
      );
      const url = `/admin/vehicles/${card.id}/steps/3/attachments`;
      expect(
        (
          await call('POST', url, tokens.admin, {
            key: foreignKey,
            kind: 'PHOTO',
          })
        ).statusCode,
      ).toBe(400);

      const ownKey = await uploadAs(
        tokens.admin,
        'PHOTO',
        'image/png',
        new Uint8Array(8),
      );
      expect(
        (
          await call(
            'POST',
            `/admin/vehicles/${card.id}/steps/14/attachments`,
            tokens.admin,
            {
              key: ownKey,
              kind: 'PHOTO',
            },
          )
        ).statusCode,
      ).toBe(400);
    });

    it('forbids non-admins from attaching files', async () => {
      const card = await createFor(fx.broker.clientId);
      const key = await uploadAs(
        tokens.broker,
        'PHOTO',
        'image/png',
        new Uint8Array(8),
      );
      const res = await call(
        'POST',
        `/admin/vehicles/${card.id}/steps/3/attachments`,
        tokens.broker,
        {
          key,
          kind: 'PHOTO',
        },
      );
      expect(res.statusCode).toBe(403);
    });
  });
});
