import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hash } from '@node-rs/argon2';
import { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { LogPushSender, PushSender } from '../src/push/push-sender.js';
import { PushService } from '../src/push/push.service.js';
import {
  PASSWORD,
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  stepEvidence,
} from './helpers.js';

const KEYS = {
  p256dh:
    'BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM',
  auth: 'tBHItJI5svbpez7KI4CCXg',
};

describe('Push notifications about dialog messages (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let sender: LogPushSender;
  let push: PushService;
  let fx: Fixtures;
  let admin2: { id: string; email: string };
  const tokens = {
    admin: '',
    admin2: '',
    broker: '',
    otherBroker: '',
    individual: '',
  };
  let counter = 0;
  const endpointOf = (name: string) =>
    `https://push.example.test/${fx.tag}/${name}-${++counter}`;

  const call = (
    method: 'GET' | 'POST' | 'DELETE',
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
  const subscribe = async (token: string, endpoint: string) => {
    const res = await call('POST', '/me/push-subscriptions', token, {
      endpoint,
      keys: KEYS,
    });
    expect(res.statusCode).toBe(204);
    return endpoint;
  };
  const newRequest = async (token = tokens.broker) => {
    const res = await call('POST', '/requests', token, {
      title: `Push ${fx.tag}`,
    });
    expect(res.statusCode).toBe(201);
    await push.idle();
    return res.json<{ id: string }>().id;
  };
  const say = async (id: string, token: string, text: string) => {
    const res = await call('POST', `/requests/${id}/messages`, token, { text });
    expect(res.statusCode).toBe(201);
    await push.idle();
  };
  /** Куда ушли уведомления по заявке: адреса подписок */
  const deliveredTo = (requestId: string) =>
    sender.sent
      .filter((s) => s.payload.requestId === requestId)
      .map((s) => s.target.endpoint);
  const pushesFor = (requestId: string, endpoint: string) =>
    sender.sent.filter(
      (s) =>
        s.payload.requestId === requestId && s.target.endpoint === endpoint,
    );

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    push = app.get(PushService);
    sender = app.get<LogPushSender>(PushSender);
    fx = await createFixtures(prisma);
    const second = await prisma.user.create({
      data: {
        email: `admin2-${fx.tag}@test.local`,
        passwordHash: await hash(PASSWORD),
        role: Role.ADMIN,
        emailVerifiedAt: new Date(),
      },
    });
    admin2 = second;
    for (const [key, email] of [
      ['admin', fx.admin.email],
      ['admin2', second.email],
      ['broker', fx.broker.email],
      ['otherBroker', fx.otherBroker.email],
      ['individual', fx.individual.email],
    ] as const) {
      tokens[key] = await accessTokenFor(app, email);
    }
  });

  afterAll(async () => {
    await push.idle();
    await prisma.user.deleteMany({ where: { id: admin2.id } }).catch(() => {});
    await fx.cleanup();
    await app.close();
  });

  beforeEach(async () => {
    sender.result = () => 'sent';
    // у каждого теста свои устройства: подписки прошлых тестов вмешивались бы в списки получателей
    await prisma.pushSubscription.deleteMany({
      where: {
        userId: {
          in: [
            fx.admin.id,
            admin2.id,
            fx.broker.id,
            fx.otherBroker.id,
            fx.individual.id,
          ],
        },
      },
    });
  });

  describe('subscriptions', () => {
    it('reports that push is not configured without VAPID keys', async () => {
      for (const token of [tokens.admin, tokens.broker, tokens.individual]) {
        const res = await call('GET', '/me/push/public-key', token);
        expect(res.statusCode).toBe(200);
        expect(res.json()).toEqual({ enabled: false, publicKey: null });
      }
      expect((await call('GET', '/me/push/public-key', null)).statusCode).toBe(
        401,
      );
    });

    it('stores a device subscription once, however many times it is sent', async () => {
      const endpoint = endpointOf('once');
      await subscribe(tokens.broker, endpoint);
      await subscribe(tokens.broker, endpoint);
      const rows = await prisma.pushSubscription.findMany({
        where: { endpoint },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        userId: fx.broker.id,
        p256dh: KEYS.p256dh,
        auth: KEYS.auth,
      });
    });

    it('remembers the browser and moves a device to the user who signs in on it', async () => {
      const endpoint = endpointOf('shared-device');
      await app.inject({
        method: 'POST',
        url: '/api/v1/me/push-subscriptions',
        headers: {
          authorization: `Bearer ${tokens.broker}`,
          'user-agent': 'TestBrowser/1.0',
        },
        payload: { endpoint, keys: KEYS },
      });
      expect(
        (
          await prisma.pushSubscription.findUniqueOrThrow({
            where: { endpoint },
          })
        ).userAgent,
      ).toBe('TestBrowser/1.0');

      await subscribe(tokens.individual, endpoint);
      const row = await prisma.pushSubscription.findUniqueOrThrow({
        where: { endpoint },
      });
      expect(row.userId).toBe(fx.individual.id);
    });

    it('keeps at most 20 devices per user, the newest ones', async () => {
      const mine = Array.from({ length: 22 }, (_, i) =>
        endpointOf(`many-${i}`),
      );
      for (const endpoint of mine)
        await subscribe(tokens.otherBroker, endpoint);
      const rows = await prisma.pushSubscription.findMany({
        where: { userId: fx.otherBroker.id },
        select: { endpoint: true },
      });
      expect(rows).toHaveLength(20);
      const kept = new Set(rows.map((r) => r.endpoint));
      expect(kept.has(mine[0])).toBe(false);
      expect(kept.has(mine[21])).toBe(true);
    });

    it('removes only the own device on unsubscribe', async () => {
      const own = await subscribe(tokens.broker, endpointOf('own'));
      const foreign = await subscribe(tokens.individual, endpointOf('foreign'));

      expect(
        (
          await call('DELETE', '/me/push-subscriptions', tokens.broker, {
            endpoint: foreign,
          })
        ).statusCode,
      ).toBe(204);
      expect(
        await prisma.pushSubscription.count({ where: { endpoint: foreign } }),
      ).toBe(1);

      expect(
        (
          await call('DELETE', '/me/push-subscriptions', tokens.broker, {
            endpoint: own,
          })
        ).statusCode,
      ).toBe(204);
      expect(
        await prisma.pushSubscription.count({ where: { endpoint: own } }),
      ).toBe(0);
    });

    it.each([
      [
        'an insecure endpoint',
        { endpoint: 'http://push.example.test/x', keys: KEYS },
      ],
      ['no endpoint', { keys: KEYS }],
      ['no keys', { endpoint: 'https://push.example.test/x' }],
      [
        'short keys',
        {
          endpoint: 'https://push.example.test/x',
          keys: { p256dh: 'a', auth: 'b' },
        },
      ],
      [
        'keys with forbidden characters',
        {
          endpoint: 'https://push.example.test/x',
          keys: { p256dh: `${KEYS.p256dh}!`, auth: KEYS.auth },
        },
      ],
      [
        'a very long endpoint',
        {
          endpoint: `https://push.example.test/${'x'.repeat(2000)}`,
          keys: KEYS,
        },
      ],
    ])('rejects %s with 400', async (_name, payload) => {
      expect(
        (await call('POST', '/me/push-subscriptions', tokens.broker, payload))
          .statusCode,
      ).toBe(400);
    });

    it('requires authentication', async () => {
      const payload = { endpoint: 'https://push.example.test/x', keys: KEYS };
      expect(
        (await call('POST', '/me/push-subscriptions', null, payload))
          .statusCode,
      ).toBe(401);
      expect(
        (
          await call('DELETE', '/me/push-subscriptions', null, {
            endpoint: payload.endpoint,
          })
        ).statusCode,
      ).toBe(401);
    });
  });

  describe('a manager writes: the owner is notified', () => {
    it('reaches every device of the owner, not the author and not other clients', async () => {
      const phone = await subscribe(tokens.broker, endpointOf('phone'));
      const laptop = await subscribe(tokens.broker, endpointOf('laptop'));
      const managerDevice = await subscribe(
        tokens.admin,
        endpointOf('manager'),
      );
      const stranger = await subscribe(
        tokens.otherBroker,
        endpointOf('stranger'),
      );

      const id = await newRequest();
      sender.sent.length = 0;
      await say(id, tokens.admin, 'Есть два варианта');

      expect(deliveredTo(id).sort()).toEqual([laptop, phone].sort());
      expect(deliveredTo(id)).not.toContain(managerDevice);
      expect(deliveredTo(id)).not.toContain(stranger);

      const [one] = pushesFor(id, phone);
      expect(one.payload).toMatchObject({
        title: 'HUATECH',
        body: `Новое сообщение по заявке «Push ${fx.tag}»`,
        url: `http://localhost:3001/requests/${id}`,
        requestId: id,
        tag: `request-${id}`,
      });
      // сам текст сообщения в уведомление не попадает
      expect(JSON.stringify(one.payload)).not.toContain('варианта');
    });

    it('works for a private person too', async () => {
      const device = await subscribe(tokens.individual, endpointOf('person'));
      const id = await newRequest(tokens.individual);
      sender.sent.length = 0;
      await say(id, tokens.admin, 'Здравствуйте');
      expect(deliveredTo(id)).toEqual([device]);
    });

    it('does not notify deactivated users', async () => {
      const device = await subscribe(tokens.individual, endpointOf('inactive'));
      const id = await newRequest(tokens.individual);
      sender.sent.length = 0;
      await prisma.user.update({
        where: { id: fx.individual.id },
        data: { isActive: false },
      });
      try {
        await say(id, tokens.admin, 'Слышите?');
        expect(deliveredTo(id)).not.toContain(device);
      } finally {
        await prisma.user.update({
          where: { id: fx.individual.id },
          data: { isActive: true },
        });
      }
    });

    it('notifies the owner of a manager comment on a status change, but not of system lines', async () => {
      const device = await subscribe(tokens.broker, endpointOf('status'));
      const id = await newRequest();
      const approved = await call(
        'POST',
        `/admin/requests/${id}/approve`,
        tokens.admin,
      );
      await push.idle();
      // одобрение пишет служебную строку — уведомления нет
      expect(deliveredTo(id)).not.toContain(device);

      const vehicleId = approved.json<{ vehicle: { id: string } }>().vehicle.id;
      const moved = await call(
        'POST',
        `/admin/vehicles/${vehicleId}/status`,
        tokens.admin,
        {
          step: 2,
          comment: 'Оплату получили',
          ...(await stepEvidence(app, fx.admin.id, 2)),
        },
      );
      expect(moved.statusCode).toBe(200);
      await push.idle();
      expect(pushesFor(id, device)).toHaveLength(1);

      // без комментария остаётся только служебная строка этапа
      await call('POST', `/admin/vehicles/${vehicleId}/status`, tokens.admin, {
        step: 3,
        ...(await stepEvidence(app, fx.admin.id, 3)),
      });
      await push.idle();
      expect(pushesFor(id, device)).toHaveLength(1);
    });
  });

  describe('the owner writes: managers are notified', () => {
    it('tells every manager about a new request and about the first message', async () => {
      const first = await subscribe(tokens.admin, endpointOf('m1'));
      const second = await subscribe(tokens.admin2, endpointOf('m2'));
      const own = await subscribe(tokens.broker, endpointOf('owner'));

      sender.sent.length = 0;
      const id = await newRequest();
      expect(deliveredTo(id).sort()).toEqual([first, second].sort());
      expect(deliveredTo(id)).not.toContain(own);
    });

    it('tells every manager while nobody has answered yet', async () => {
      const first = await subscribe(tokens.admin, endpointOf('m1'));
      const second = await subscribe(tokens.admin2, endpointOf('m2'));
      const id = await newRequest();
      sender.sent.length = 0;
      await say(id, tokens.broker, 'Есть новости?');
      expect(deliveredTo(id).sort()).toEqual([first, second].sort());
      expect(pushesFor(id, first)[0].payload.url).toBe(
        `http://localhost:3001/admin/requests/${id}`,
      );
    });

    it('tells only the manager who answered last, and follows the one who answers next', async () => {
      const first = await subscribe(tokens.admin, endpointOf('m1'));
      const second = await subscribe(tokens.admin2, endpointOf('m2'));
      const id = await newRequest();

      await say(id, tokens.admin, 'Здравствуйте, я подберу варианты');
      expect(
        (await prisma.request.findUniqueOrThrow({ where: { id } })).assigneeId,
      ).toBe(fx.admin.id);

      sender.sent.length = 0;
      await say(id, tokens.broker, 'Хорошо');
      expect(deliveredTo(id)).toEqual([first]);

      // отвечает другой сотрудник — теперь ответственный он
      await say(id, tokens.admin2, 'Я подхвачу');
      expect(
        (await prisma.request.findUniqueOrThrow({ where: { id } })).assigneeId,
      ).toBe(admin2.id);
      sender.sent.length = 0;
      await say(id, tokens.broker, 'Спасибо');
      expect(deliveredTo(id)).toEqual([second]);
    });

    it('falls back to all managers when the assignee is deactivated', async () => {
      const first = await subscribe(tokens.admin, endpointOf('m1'));
      const second = await subscribe(tokens.admin2, endpointOf('m2'));
      const id = await newRequest();
      await say(id, tokens.admin2, 'Беру');

      await prisma.user.update({
        where: { id: admin2.id },
        data: { isActive: false },
      });
      try {
        sender.sent.length = 0;
        await say(id, tokens.broker, 'Есть кто?');
        expect(deliveredTo(id)).toEqual([first]);
        expect(deliveredTo(id)).not.toContain(second);
      } finally {
        await prisma.user.update({
          where: { id: admin2.id },
          data: { isActive: true },
        });
      }
    });
  });

  describe('a message that stays without an answer', () => {
    const hours = (n: number) => new Date(Date.now() + n * 60 * 60 * 1000);

    /** Заявка, где ответил admin, а потом снова написал клиент */
    async function waiting() {
      const first = await subscribe(tokens.admin, endpointOf('m1'));
      const second = await subscribe(tokens.admin2, endpointOf('m2'));
      const id = await newRequest();
      await say(id, tokens.admin, 'Беру в работу');
      await say(id, tokens.broker, 'Жду');
      sender.sent.length = 0;
      return { id, first, second };
    }

    it('reaches the other managers after the fallback time, once', async () => {
      const { id, first, second } = await waiting();

      // рано: прошло меньше часа
      await push.escalate(new Date(Date.now() + 30 * 60 * 1000));
      expect(deliveredTo(id)).toEqual([]);

      await push.escalate(hours(1.1));
      expect(deliveredTo(id)).toEqual([second]);
      expect(deliveredTo(id)).not.toContain(first);
      expect(pushesFor(id, second)[0].payload).toMatchObject({
        body: `Заявка «Push ${fx.tag}» ждёт ответа`,
        url: `http://localhost:3001/admin/requests/${id}`,
      });

      // второй раз то же сообщение не рассылается
      await push.escalate(hours(2));
      expect(deliveredTo(id)).toEqual([second]);
    });

    it('is counted once even when two instances check at the same moment', async () => {
      const { id, second } = await waiting();
      const now = hours(1.2);
      await Promise.all([push.escalate(now), push.escalate(now)]);
      expect(pushesFor(id, second)).toHaveLength(1);
    });

    it('starts over after the client writes again', async () => {
      const { id, second } = await waiting();
      // состарим сообщение клиента, чтобы проверка сработала в настоящем времени
      await prisma.request.update({
        where: { id },
        data: { lastMessageAt: new Date(Date.now() - 2 * 60 * 60 * 1000) },
      });
      await push.escalate();
      expect(pushesFor(id, second)).toHaveLength(1);

      await new Promise((r) => setTimeout(r, 20));
      await say(id, tokens.broker, 'Ау?');
      // новое сообщение сначала идёт только ответственному
      expect(pushesFor(id, second)).toHaveLength(1);

      await push.escalate(hours(1.5));
      expect(pushesFor(id, second)).toHaveLength(2);
    });

    it('does not bother anybody when the request was answered, closed or has no assignee', async () => {
      const second = await subscribe(tokens.admin2, endpointOf('m2'));
      await subscribe(tokens.admin, endpointOf('m1'));

      const answered = await newRequest();
      await say(answered, tokens.admin, 'Ответ');

      const closed = await newRequest();
      await say(closed, tokens.admin, 'Ответ');
      await say(closed, tokens.broker, 'Ещё вопрос');
      await call('POST', `/admin/requests/${closed}/reject`, tokens.admin);

      const unassigned = await newRequest();
      sender.sent.length = 0;

      await push.escalate(hours(3));
      for (const id of [answered, closed, unassigned]) {
        expect(pushesFor(id, second)).toHaveLength(0);
      }
    });
  });

  describe('failures', () => {
    it('removes a subscription the push service reports as gone, keeps one that merely failed', async () => {
      const gone = await subscribe(tokens.broker, endpointOf('gone'));
      const flaky = await subscribe(tokens.broker, endpointOf('flaky'));
      const fine = await subscribe(tokens.broker, endpointOf('fine'));
      sender.result = (target) =>
        target.endpoint === gone
          ? 'gone'
          : target.endpoint === flaky
            ? 'failed'
            : 'sent';

      const id = await newRequest();
      await say(id, tokens.admin, 'Привет');

      expect(
        await prisma.pushSubscription.count({ where: { endpoint: gone } }),
      ).toBe(0);
      expect(
        await prisma.pushSubscription.count({ where: { endpoint: flaky } }),
      ).toBe(1);
      expect(
        await prisma.pushSubscription.count({ where: { endpoint: fine } }),
      ).toBe(1);
    });

    it('never fails the message when the sender throws', async () => {
      await subscribe(tokens.broker, endpointOf('boom'));
      const id = await newRequest();
      const spy = vi
        .spyOn(sender, 'send')
        .mockRejectedValue(new Error('network down'));
      try {
        const res = await call(
          'POST',
          `/requests/${id}/messages`,
          tokens.admin,
          { text: 'Работает?' },
        );
        expect(res.statusCode).toBe(201);
        await push.idle();
        expect(spy).toHaveBeenCalled();
      } finally {
        spy.mockRestore();
      }
      const list = await call('GET', `/requests/${id}/messages`, tokens.broker);
      expect(list.json<{ items: unknown[] }>().items).toHaveLength(2);
    });
  });
});
