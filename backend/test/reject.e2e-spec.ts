import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
} from './helpers.js';

interface RequestView {
  id: string;
  status: 'NEW' | 'IN_DIALOG' | 'APPROVED' | 'REJECTED';
  vehicleId: string | null;
}

describe('Request rejection (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '', otherBroker: '', individual: '' };

  const call = (
    method: 'GET' | 'POST',
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

  async function newRequest(token = tokens.broker) {
    const res = await call('POST', '/requests', token, {
      title: `Reject ${fx.tag}`,
    });
    expect(res.statusCode).toBe(201);
    return res.json<RequestView>().id;
  }
  const reject = (id: string, token: string | null = tokens.admin) =>
    call('POST', `/admin/requests/${id}/reject`, token);
  const approve = (id: string) =>
    call('POST', `/admin/requests/${id}/approve`, tokens.admin);
  const statusOf = async (id: string) =>
    (await prisma.request.findUniqueOrThrow({ where: { id } })).status;

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

  describe('rejecting', () => {
    it('rejects a NEW request without creating a vehicle', async () => {
      const id = await newRequest();
      const vehicles = await prisma.vehicle.count({
        where: { clientId: fx.broker.clientId },
      });

      const res = await reject(id);
      expect(res.statusCode).toBe(200);
      expect(res.json<RequestView>()).toMatchObject({
        id,
        status: 'REJECTED',
        vehicleId: null,
      });
      expect(await statusOf(id)).toBe('REJECTED');
      expect(
        await prisma.vehicle.count({ where: { clientId: fx.broker.clientId } }),
      ).toBe(vehicles);
    });

    it('rejects an IN_DIALOG request', async () => {
      const id = await newRequest();
      await call('POST', `/requests/${id}/messages`, tokens.admin, {
        text: 'Есть варианты',
      });
      expect(await statusOf(id)).toBe('IN_DIALOG');

      expect((await reject(id)).json<RequestView>().status).toBe('REJECTED');
    });

    it('is idempotent', async () => {
      const id = await newRequest();
      expect((await reject(id)).statusCode).toBe(200);
      const again = await reject(id);
      expect(again.statusCode).toBe(200);
      expect(again.json<RequestView>().status).toBe('REJECTED');
    });

    it('cannot reject an approved request', async () => {
      const id = await newRequest();
      await approve(id);
      const res = await reject(id);
      expect(res.statusCode).toBe(409);
      expect(await statusOf(id)).toBe('APPROVED');
    });

    it('cannot approve a rejected request', async () => {
      const id = await newRequest();
      await reject(id);
      const res = await approve(id);
      expect(res.statusCode).toBe(409);
      expect(await statusOf(id)).toBe('REJECTED');
      expect(
        await prisma.request.findUniqueOrThrow({ where: { id } }),
      ).toMatchObject({ vehicleId: null });
    });

    it('answers 404 for an unknown request and 400 for a malformed id', async () => {
      expect(
        (await reject('00000000-0000-4000-8000-000000000000')).statusCode,
      ).toBe(404);
      expect((await reject('nope')).statusCode).toBe(400);
    });
  });

  describe('access', () => {
    it.each(['broker', 'individual'] as const)(
      'forbids %s to reject (even their own request)',
      async (who) => {
        const id = await newRequest(tokens[who]);
        expect((await reject(id, tokens[who])).statusCode).toBe(403);
        expect(await statusOf(id)).toBe('NEW');
      },
    );

    it('requires authentication', async () => {
      const id = await newRequest();
      expect((await reject(id, null)).statusCode).toBe(401);
    });
  });

  describe('dialog after rejection', () => {
    it('becomes read-only for everyone but stays readable', async () => {
      const id = await newRequest();
      await call('POST', `/requests/${id}/messages`, tokens.broker, {
        text: 'до',
      });
      await reject(id);

      for (const token of [tokens.broker, tokens.admin]) {
        const res = await call('POST', `/requests/${id}/messages`, token, {
          text: 'после',
        });
        expect(res.statusCode).toBe(409);
      }
      const voice = await call(
        'POST',
        `/requests/${id}/voice-upload-url`,
        tokens.broker,
        { mime: 'audio/webm', size: 1000 },
      );
      expect(voice.statusCode).toBe(409);

      const list = await call('GET', `/requests/${id}/messages`, tokens.broker);
      expect(list.statusCode).toBe(200);
      // в ленте: сама заявка, «до» и служебная строка об отклонении; «после» не попало
      const items = list.json<{ items: { type: string; text: string }[] }>()
        .items;
      expect(
        items.filter((m) => m.type !== 'SYSTEM').map((m) => m.text),
      ).toEqual([expect.stringContaining('Новая заявка'), 'до']);
      expect(items.filter((m) => m.type === 'SYSTEM')).toHaveLength(1);
      expect(
        (await call('POST', `/requests/${id}/read`, tokens.broker)).statusCode,
      ).toBe(200);
    });

    it('serializes rejection with message posting: no message after REJECTED', async () => {
      const id = await newRequest();
      const results = await Promise.all([
        reject(id),
        ...Array.from({ length: 6 }, (_, i) =>
          call('POST', `/requests/${id}/messages`, tokens.broker, {
            text: `гонка ${i}`,
          }),
        ),
      ]);
      expect(results[0].statusCode).toBe(200);
      for (const r of results.slice(1))
        expect([201, 409]).toContain(r.statusCode);
      const accepted = results
        .slice(1)
        .filter((r) => r.statusCode === 201).length;
      // принятые сообщения плюс первое сообщение самой заявки
      expect(
        await prisma.message.count({
          where: { requestId: id, type: { not: 'SYSTEM' } },
        }),
      ).toBe(accepted + 1);
    });

    it('lets exactly one of a concurrent approve and reject win', async () => {
      const id = await newRequest();
      const [a, r] = await Promise.all([approve(id), reject(id)]);
      const codes = [a.statusCode, r.statusCode].sort();
      expect(codes).toEqual([200, 409]);

      const final = await statusOf(id);
      expect(['APPROVED', 'REJECTED']).toContain(final);
      const vehicle = (
        await prisma.request.findUniqueOrThrow({ where: { id } })
      ).vehicleId;
      expect(vehicle !== null).toBe(final === 'APPROVED');
    });
  });

  describe('lists', () => {
    it('filters by REJECTED for the client and the manager queue', async () => {
      const id = await newRequest();
      await reject(id);

      const mine = await call(
        'GET',
        '/requests?status=REJECTED',
        tokens.broker,
      );
      expect(mine.statusCode).toBe(200);
      const items = mine.json<{ items: RequestView[] }>().items;
      expect(items.map((r) => r.id)).toContain(id);
      expect(items.every((r) => r.status === 'REJECTED')).toBe(true);

      const queue = await call(
        'GET',
        `/admin/requests?status=REJECTED&clientId=${fx.broker.clientId}`,
        tokens.admin,
      );
      expect(
        queue.json<{ items: RequestView[] }>().items.map((r) => r.id),
      ).toContain(id);

      // чужой подборщик такую заявку не видит
      const other = await call('GET', `/requests/${id}`, tokens.otherBroker);
      expect(other.statusCode).toBe(404);
    });
  });
});
