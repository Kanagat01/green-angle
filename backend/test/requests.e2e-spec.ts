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
  title: string;
  yearFrom: number | null;
  budget: number | null;
  comment: string | null;
  status: 'NEW' | 'IN_DIALOG' | 'APPROVED';
  vehicleId: string | null;
  client: { id: string; type: string; name: string };
  createdAt: string;
}
interface List {
  items: RequestView[];
  total: number;
}

describe('Requests (e2e)', () => {
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

  const create = (token: string | null, payload: object) =>
    call('POST', '/requests', token, payload);

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

  describe('creation', () => {
    it('creates a NEW request for the broker client with all fields', async () => {
      const res = await create(tokens.broker, {
        title: 'Chery Tiggo 8 Pro',
        yearFrom: 2023,
        budget: 3200000.5,
        comment: 'Чёрный салон',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<RequestView>()).toMatchObject({
        title: 'Chery Tiggo 8 Pro',
        yearFrom: 2023,
        budget: 3200000.5,
        comment: 'Чёрный салон',
        status: 'NEW',
        vehicleId: null,
        client: { id: fx.broker.clientId, type: 'COMPANY' },
      });

      const stored = await prisma.request.findUniqueOrThrow({
        where: { id: res.json<RequestView>().id },
      });
      expect(stored.createdById).toBe(fx.broker.id);
      expect(stored.clientId).toBe(fx.broker.clientId);
    });

    it('accepts only the title; optional fields are null', async () => {
      const res = await create(tokens.individual, { title: 'Zeekr 001' });
      expect(res.statusCode).toBe(201);
      expect(res.json<RequestView>()).toMatchObject({
        yearFrom: null,
        budget: null,
        comment: null,
        client: { id: fx.individual.clientId, type: 'PERSON' },
      });
    });

    it('ignores client-controlled clientId, status and vehicleId', async () => {
      const res = await create(tokens.broker, {
        title: 'Spoof attempt',
        clientId: fx.otherBroker.clientId,
        status: 'APPROVED',
        vehicleId: fx.otherBroker.vehicleId,
        createdById: fx.admin.id,
      });
      expect(res.statusCode).toBe(201);
      const body = res.json<RequestView>();
      expect(body.status).toBe('NEW');
      expect(body.vehicleId).toBeNull();
      expect(body.client.id).toBe(fx.broker.clientId);

      const stored = await prisma.request.findUniqueOrThrow({
        where: { id: body.id },
      });
      expect(stored.createdById).toBe(fx.broker.id);
    });

    it.each([
      ['empty title', { title: '' }],
      ['missing title', { yearFrom: 2023 }],
      ['title too long', { title: 'x'.repeat(201) }],
      ['year too old', { title: 'X', yearFrom: 1980 }],
      ['year in the far future', { title: 'X', yearFrom: 2999 }],
      ['fractional year', { title: 'X', yearFrom: 2020.5 }],
      ['negative budget', { title: 'X', budget: -1 }],
      ['budget with 3 decimals', { title: 'X', budget: 1.234 }],
      ['budget as string', { title: 'X', budget: 'much' }],
      ['huge budget', { title: 'X', budget: 1e15 }],
      ['comment too long', { title: 'X', comment: 'x'.repeat(2001) }],
    ])('rejects %s with 400', async (_name, payload) => {
      expect((await create(tokens.broker, payload)).statusCode).toBe(400);
    });

    it('forbids ADMIN from creating requests', async () => {
      expect((await create(tokens.admin, { title: 'X' })).statusCode).toBe(403);
    });

    it('requires authentication', async () => {
      expect((await create(null, { title: 'X' })).statusCode).toBe(401);
      expect((await call('GET', '/requests', null)).statusCode).toBe(401);
    });
  });

  describe('listing, scope and filters', () => {
    let brokerNew: RequestView;
    let brokerDialog: RequestView;
    let otherReq: RequestView;
    let personReq: RequestView;

    beforeAll(async () => {
      const mk = async (token: string, title: string) =>
        (await create(token, { title })).json<RequestView>();
      brokerNew = await mk(tokens.broker, `Broker new ${fx.tag}`);
      brokerDialog = await mk(tokens.broker, `Broker dialog ${fx.tag}`);
      otherReq = await mk(tokens.otherBroker, `Other ${fx.tag}`);
      personReq = await mk(tokens.individual, `Person ${fx.tag}`);
      await prisma.request.update({
        where: { id: brokerDialog.id },
        data: { status: 'IN_DIALOG' },
      });
    });

    const ids = async (url: string, token: string) =>
      (await call('GET', url, token)).json<List>().items.map((r) => r.id);

    it('broker sees only its own requests', async () => {
      const list = await ids('/requests', tokens.broker);
      expect(list).toEqual(
        expect.arrayContaining([brokerNew.id, brokerDialog.id]),
      );
      expect(list).not.toContain(otherReq.id);
      expect(list).not.toContain(personReq.id);
    });

    it('individual does not see company requests', async () => {
      const list = await ids('/requests', tokens.individual);
      expect(list).toContain(personReq.id);
      expect(list).not.toContain(brokerNew.id);
      expect(list).not.toContain(otherReq.id);
    });

    it('ignores a foreign clientId in the client query', async () => {
      const list = await ids(
        `/requests?clientId=${fx.otherBroker.clientId}`,
        tokens.broker,
      );
      expect(list).toContain(brokerNew.id);
      expect(list).not.toContain(otherReq.id);
    });

    it('lists newest first', async () => {
      const items = (await call('GET', '/requests', tokens.broker)).json<List>()
        .items;
      const times = items.map((r) => Date.parse(r.createdAt));
      expect(times).toEqual([...times].sort((a, b) => b - a));
    });

    it('filters by status for the client', async () => {
      const dialog = await ids('/requests?status=IN_DIALOG', tokens.broker);
      expect(dialog).toContain(brokerDialog.id);
      expect(dialog).not.toContain(brokerNew.id);
    });

    it('admin queue contains requests of all clients', async () => {
      const list = await ids('/admin/requests?limit=200', tokens.admin);
      expect(list).toEqual(
        expect.arrayContaining([
          brokerNew.id,
          brokerDialog.id,
          otherReq.id,
          personReq.id,
        ]),
      );
    });

    it('admin queue filters by status and client', async () => {
      const byStatus = await ids(
        `/admin/requests?status=IN_DIALOG&clientId=${fx.broker.clientId}`,
        tokens.admin,
      );
      expect(byStatus).toEqual([brokerDialog.id]);

      const byClient = await ids(
        `/admin/requests?clientId=${fx.otherBroker.clientId}`,
        tokens.admin,
      );
      expect(byClient).toEqual([otherReq.id]);

      const newOnly = await ids(
        `/admin/requests?status=NEW&clientId=${fx.broker.clientId}`,
        tokens.admin,
      );
      expect(newOnly).toContain(brokerNew.id);
      expect(newOnly).not.toContain(brokerDialog.id);
    });

    it('forbids non-admins from the admin queue', async () => {
      for (const who of ['broker', 'individual'] as const) {
        expect(
          (await call('GET', '/admin/requests', tokens[who])).statusCode,
        ).toBe(403);
      }
    });

    it('paginates and reports the total', async () => {
      const url = `/admin/requests?clientId=${fx.broker.clientId}`;
      const all = (await call('GET', url, tokens.admin)).json<List>();
      expect(all.total).toBeGreaterThanOrEqual(2);
      const first = (
        await call('GET', `${url}&limit=1`, tokens.admin)
      ).json<List>();
      const second = (
        await call('GET', `${url}&limit=1&offset=1`, tokens.admin)
      ).json<List>();
      expect(first.items).toHaveLength(1);
      expect(first.items[0].id).not.toBe(second.items[0].id);
      expect(first.total).toBe(all.total);
    });

    it('validates query parameters', async () => {
      expect(
        (await call('GET', '/requests?status=BOGUS', tokens.broker)).statusCode,
      ).toBe(400);
      expect(
        (await call('GET', '/admin/requests?clientId=nope', tokens.admin))
          .statusCode,
      ).toBe(400);
      expect(
        (await call('GET', '/requests?limit=0', tokens.broker)).statusCode,
      ).toBe(400);
    });

    it('returns a request to its owner and to admin', async () => {
      for (const token of [tokens.broker, tokens.admin]) {
        const res = await call('GET', `/requests/${brokerNew.id}`, token);
        expect(res.statusCode).toBe(200);
        expect(res.json<RequestView>()).toMatchObject({
          id: brokerNew.id,
          status: 'NEW',
        });
      }
    });

    it('returns 404 (not 403) for a request of another client', async () => {
      for (const [token, req] of [
        [tokens.broker, otherReq],
        [tokens.broker, personReq],
        [tokens.individual, brokerNew],
        [tokens.otherBroker, brokerNew],
      ] as const) {
        expect(
          (await call('GET', `/requests/${req.id}`, token)).statusCode,
        ).toBe(404);
      }
    });

    it('returns 400 for a malformed id and 404 for an unknown one', async () => {
      expect(
        (await call('GET', '/requests/not-a-uuid', tokens.broker)).statusCode,
      ).toBe(400);
      expect(
        (
          await call(
            'GET',
            '/requests/00000000-0000-4000-8000-000000000000',
            tokens.broker,
          )
        ).statusCode,
      ).toBe(404);
    });
  });
});
