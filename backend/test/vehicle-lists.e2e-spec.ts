import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  stepEvidence,
} from './helpers.js';

interface Item {
  id: string;
  title: string;
  vin: string | null;
  currentStep: number;
  requestId: string | null;
  attachmentsCount: number;
  awaitingAttachment: boolean;
  createdAt: string;
  updatedAt: string;
  client: { id: string; type: string };
}
interface List {
  items: Item[];
  total: number;
  counts: {
    all: number;
    active: number;
    ready: number;
    company: number;
    person: number;
  };
}

describe('Vehicle lists: search, filters, counters and card data (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '', otherBroker: '', individual: '' };
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

  const call = (
    method: 'GET' | 'POST' | 'PATCH',
    url: string,
    token: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${url}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });
  const clientList = async (query = '', token = tokens.broker) => {
    const res = await call('GET', `/vehicles?limit=100${query}`, token);
    expect(res.statusCode).toBe(200);
    return res.json<List>();
  };
  const adminList = async (query = '') => {
    const res = await call(
      'GET',
      `/admin/vehicles?limit=100${query}`,
      tokens.admin,
    );
    expect(res.statusCode).toBe(200);
    return res.json<List>();
  };
  const make = async (
    clientId: string,
    title: string,
    vin: string,
    startStep: number,
  ) => {
    const res = await call('POST', '/admin/vehicles', tokens.admin, {
      title,
      vin,
      clientId,
      startStep,
    });
    expect(res.statusCode).toBe(201);
    return res.json<Item>().id;
  };
  const ids = (list: List) => list.items.map((v) => v.id);
  /** Метка названий машин этого набора: по ней их ищут, не задевая машины фикстур и других наборов */
  const mark = () => `lst ${fx.tag}`;

  // свои машины: у подборщика две в пути и одна готовая, у физ.лица одна в пути
  let monjaro: string;
  let tiggo: string;
  let li: string;
  let zeekr: string;
  // VIN по ISO 3779 не содержит I, O, Q; хвост из нулей, префикс уникален внутри набора
  const vin = (suffix: string) =>
    `LVS${suffix}${randomUUID().replace(/\D/g, '').slice(0, 6)}`.padEnd(
      17,
      '0',
    );

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    fx = await createFixtures(prisma);
    for (const [key, email] of [
      ['admin', fx.admin.email],
      ['broker', fx.broker.email],
      ['otherBroker', fx.otherBroker.email],
      ['individual', fx.individual.email],
    ] as const) {
      tokens[key] = await accessTokenFor(app, email);
    }
    const t = mark();
    // машины фикстур (по одной у каждого клиента) тоже на шаге 1 и в счётчиках участвуют
    monjaro = await make(
      fx.broker.clientId,
      `Geely Monjaro ${t}`,
      vin('AAA1'),
      9,
    );
    tiggo = await make(fx.broker.clientId, `Chery Tiggo ${t}`, vin('BBB2'), 2);
    li = await make(fx.broker.clientId, `Li Auto L9 ${t}`, vin('CCC3'), 13);
    zeekr = await make(
      fx.individual.clientId,
      `Zeekr 001 ${t}`,
      vin('DDD4'),
      5,
    );
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  describe('search and state for the client', () => {
    it('searches by title, case-insensitively', async () => {
      const list = await clientList(`&search=${encodeURIComponent('tiggo')}`);
      expect(ids(list)).toEqual([tiggo]);
      expect(list.total).toBe(1);
    });

    it('searches by a part of the VIN, case-insensitively', async () => {
      expect(ids(await clientList('&search=aaa1'))).toEqual([monjaro]);
      expect(ids(await clientList('&search=CCC3'))).toEqual([li]);
    });

    it('finds nothing for an unknown text and keeps the counters', async () => {
      const list = await clientList('&search=zzzz-no-such');
      expect(list.items).toHaveLength(0);
      expect(list.total).toBe(0);
      expect(list.counts.all).toBeGreaterThanOrEqual(3);
    });

    it('filters vehicles on the way and ready for delivery', async () => {
      const active = await clientList('&state=active');
      expect(ids(active)).toEqual(expect.arrayContaining([monjaro, tiggo]));
      expect(ids(active)).not.toContain(li);
      expect(active.items.every((v) => v.currentStep < 13)).toBe(true);

      const ready = await clientList('&state=ready');
      expect(ids(ready)).toEqual([li]);
    });

    it('combines search and state', async () => {
      const t = mark();
      expect(
        ids(await clientList(`&state=ready&search=${encodeURIComponent(t)}`)),
      ).toEqual([li]);
      expect(
        ids(
          await clientList(
            `&state=active&search=${encodeURIComponent('li auto')}`,
          ),
        ),
      ).toEqual([]);
    });

    it('never leaks other clients, whatever is searched', async () => {
      const other = await clientList('&search=Zeekr');
      expect(other.items).toHaveLength(0);
      const individual = await clientList('&search=Zeekr', tokens.individual);
      expect(ids(individual)).toEqual([zeekr]);
    });
  });

  describe('counters', () => {
    it('are per client and ignore the filters', async () => {
      const all = await clientList();
      // у подборщика: машина фикстуры (шаг 1) + три созданные
      expect(all.counts).toEqual({
        all: 4,
        active: 3,
        ready: 1,
        company: 4,
        person: 0,
      });
      const filtered = await clientList('&state=ready&search=Li');
      expect(filtered.counts).toEqual(all.counts);
      expect(filtered.total).toBe(1);

      const person = await clientList('', tokens.individual);
      expect(person.counts).toEqual({
        all: 2,
        active: 2,
        ready: 0,
        company: 0,
        person: 2,
      });
    });

    it('add up: all = active + ready', async () => {
      const { counts } = await adminList();
      expect(counts.all).toBe(counts.active + counts.ready);
      expect(counts.all).toBe(counts.company + counts.person);
    });
  });

  describe('manager list', () => {
    it('filters by the owner type', async () => {
      const t = encodeURIComponent(mark());
      const company = await adminList(`&ownerType=COMPANY&search=${t}`);
      expect(ids(company)).toEqual(
        expect.arrayContaining([monjaro, tiggo, li]),
      );
      expect(ids(company)).not.toContain(zeekr);
      expect(company.items.every((v) => v.client.type === 'COMPANY')).toBe(
        true,
      );

      const person = await adminList(`&ownerType=PERSON&search=${t}`);
      expect(ids(person)).toEqual([zeekr]);
    });

    it('searches by title or VIN for managers too, and still supports the vin filter', async () => {
      expect(ids(await adminList('&search=Zeekr'))).toContain(zeekr);
      const byVin = await adminList('&vin=ddd4');
      expect(ids(byVin)).toEqual([zeekr]);
    });

    it('combines the owner type with a state and a client', async () => {
      const res = await adminList(
        `&ownerType=COMPANY&state=ready&clientId=${fx.broker.clientId}`,
      );
      expect(ids(res)).toEqual([li]);
    });

    it('counts the whole base, not just the filtered page', async () => {
      const narrow = await adminList(
        `&ownerType=PERSON&search=${encodeURIComponent(mark())}`,
      );
      const wide = await adminList();
      expect(narrow.counts).toEqual(wide.counts);
      expect(wide.counts.company).toBeGreaterThanOrEqual(4);
      expect(wide.counts.person).toBeGreaterThanOrEqual(2);
    });

    it('keeps pagination consistent with filters', async () => {
      const t = encodeURIComponent(mark());
      const first = await call(
        'GET',
        `/admin/vehicles?ownerType=COMPANY&search=${t}&limit=2&offset=0`,
        tokens.admin,
      );
      const second = await call(
        'GET',
        `/admin/vehicles?ownerType=COMPANY&search=${t}&limit=2&offset=2`,
        tokens.admin,
      );
      const a = first.json<List>();
      const b = second.json<List>();
      expect(a.total).toBe(3);
      expect(a.items).toHaveLength(2);
      expect(b.items).toHaveLength(1);
      expect(new Set([...ids(a), ...ids(b)]).size).toBe(3);
    });
  });

  describe('validation', () => {
    it.each([
      '/vehicles?state=done',
      `/vehicles?search=${'x'.repeat(101)}`,
      '/admin/vehicles?ownerType=BROKER',
      '/admin/vehicles?state=',
    ])('rejects %s with 400', async (url) => {
      const token = url.startsWith('/admin') ? tokens.admin : tokens.broker;
      expect((await call('GET', url, token)).statusCode).toBe(400);
    });

    it('lets a client use the owner-type filter only for themselves', async () => {
      // фильтра ownerType у клиента нет: параметр игнорируется, а чужие данные недоступны
      const res = await call(
        'GET',
        '/vehicles?ownerType=PERSON',
        tokens.broker,
      );
      expect(res.statusCode).toBe(200);
      expect(
        res.json<List>().items.every((v) => v.client.id === fx.broker.clientId),
      ).toBe(true);
    });
  });

  describe('request link, updated time and attachments', () => {
    it('links a vehicle created from a request to its dialog, a manual one has no link', async () => {
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

      const list = await clientList(`&search=${encodeURIComponent('Linked')}`);
      expect(list.items.find((v) => v.id === vehicleId)?.requestId).toBe(
        requestId,
      );
      const card = await call('GET', `/vehicles/${vehicleId}`, tokens.broker);
      expect(card.json<Item>().requestId).toBe(requestId);

      const manual = await call('GET', `/vehicles/${monjaro}`, tokens.broker);
      expect(manual.json<Item>().requestId).toBeNull();
    });

    it('counts step attachments in the list and in the card', async () => {
      const card0 = (
        await call('GET', `/vehicles/${tiggo}`, tokens.broker)
      ).json<Item>();
      expect(card0.attachmentsCount).toBe(0);

      const res = await call(
        'POST',
        `/admin/vehicles/${tiggo}/status`,
        tokens.admin,
        {
          step: 3,
          attachments: (await stepEvidence(app, fx.admin.id, 3)).attachments,
        },
      );
      expect(res.statusCode).toBe(200);
      expect(res.json<Item>().attachmentsCount).toBe(1);

      const card = (
        await call('GET', `/vehicles/${tiggo}`, tokens.broker)
      ).json<Item>();
      expect(card.attachmentsCount).toBe(1);
      const row = (await clientList('&search=Tiggo')).items[0];
      expect(row.attachmentsCount).toBe(1);

      // ещё одно вложение на тот же шаг
      const more = await call(
        'POST',
        `/admin/vehicles/${tiggo}/status`,
        tokens.admin,
        {
          step: 3,
          attachments: (await stepEvidence(app, fx.admin.id, 3)).attachments,
        },
      );
      expect(more.json<Item>().attachmentsCount).toBe(2);
    });

    it('moves the updated time on a status change and on a title or VIN edit', async () => {
      const before = (
        await call('GET', `/vehicles/${li}`, tokens.broker)
      ).json<Item>();
      expect(new Date(before.updatedAt).getTime()).toBeGreaterThanOrEqual(
        new Date(before.createdAt).getTime(),
      );
      await sleep(20);

      await call('PATCH', `/admin/vehicles/${li}`, tokens.admin, {
        title: `Li Auto L9 (новое название) ${fx.tag}`,
      });
      const afterEdit = (
        await call('GET', `/vehicles/${li}`, tokens.broker)
      ).json<Item>();
      expect(new Date(afterEdit.updatedAt).getTime()).toBeGreaterThan(
        new Date(before.updatedAt).getTime(),
      );

      await sleep(20);
      const moved = await call(
        'POST',
        `/admin/vehicles/${li}/status`,
        tokens.admin,
        {
          step: 12,
        },
      );
      expect(moved.statusCode).toBe(200);
      expect(new Date(moved.json<Item>().updatedAt).getTime()).toBeGreaterThan(
        new Date(afterEdit.updatedAt).getTime(),
      );
    });

    it('flags a vehicle whose current step still waits for an attachment or a declaration number', async () => {
      const flag = async (id: string) => {
        const card = (
          await call('GET', `/vehicles/${id}`, tokens.broker)
        ).json<Item>();
        const row = (
          await clientList(`&search=${encodeURIComponent('Await')}`)
        ).items.find((v) => v.id === id);
        expect(row?.awaitingAttachment).toBe(card.awaitingAttachment);
        return card.awaitingAttachment;
      };
      const t = mark();
      const photo = await make(
        fx.broker.clientId,
        `Await photo ${t}`,
        vin('EEE5'),
        9,
      );
      const none = await make(
        fx.broker.clientId,
        `Await none ${t}`,
        vin('FFF6'),
        5,
      );
      const declaration = await make(
        fx.broker.clientId,
        `Await declaration ${t}`,
        vin('GGG7'),
        10,
      );

      expect(await flag(photo)).toBe(true);
      expect(await flag(none)).toBe(false);
      expect(await flag(declaration)).toBe(true);

      await call('POST', `/admin/vehicles/${photo}/status`, tokens.admin, {
        step: 9,
        attachments: (await stepEvidence(app, fx.admin.id, 9)).attachments,
      });
      await call(
        'POST',
        `/admin/vehicles/${declaration}/status`,
        tokens.admin,
        {
          step: 10,
          declarationNumber: '10702070/181024/5012345',
        },
      );
      expect(await flag(photo)).toBe(false);
      expect(await flag(declaration)).toBe(false);
    });

    it('has the same fields in the list, the card and the admin list', async () => {
      const fromList = (await clientList('&search=Monjaro')).items[0];
      const fromCard = (
        await call('GET', `/vehicles/${monjaro}`, tokens.broker)
      ).json<Item>();
      const fromAdmin = (await adminList('&search=Monjaro')).items.find(
        (v) => v.id === monjaro,
      )!;
      for (const key of [
        'requestId',
        'attachmentsCount',
        'awaitingAttachment',
        'updatedAt',
      ] as const) {
        expect(fromList[key]).toEqual(fromCard[key]);
        expect(fromAdmin[key]).toEqual(fromCard[key]);
      }
    });
  });
});
