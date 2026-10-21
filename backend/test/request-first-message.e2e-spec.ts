import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
} from './helpers.js';

interface Message {
  id: string;
  type: string;
  text: string | null;
  author: { id: string; role: string } | null;
  isMine: boolean;
}

describe('First message of a request (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '', individual: '' };

  const call = (
    method: 'GET' | 'POST',
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
  const create = async (token: string, payload: object) => {
    const res = await call('POST', '/requests', token, payload);
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string; status: string; unreadCount: number }>();
  };
  const dialog = async (id: string, token: string) =>
    (await call('GET', `/requests/${id}/messages`, token)).json<{
      items: Message[];
    }>().items;

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

  it('starts the dialog with the request itself, written by the client', async () => {
    const request = await create(tokens.broker, {
      title: 'Haval Jolion',
      yearFrom: 2023,
      budget: 1_600_000,
      comment: 'Нужен именно 2023 год, механика не нужна.',
    });
    expect(request.status).toBe('NEW');

    const items = await dialog(request.id, tokens.broker);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({
      type: 'TEXT',
      text: 'Новая заявка: Haval Jolion, 2023. Бюджет 1 600 000 ₽.\nНужен именно 2023 год, механика не нужна.',
      author: { id: fx.broker.id, role: 'BROKER' },
      isMine: true,
    });
  });

  it('writes only what was given', async () => {
    const cases: [object, string][] = [
      [{ title: 'Zeekr 001' }, 'Новая заявка: Zeekr 001.'],
      [
        { title: 'Zeekr 001', yearFrom: 2025 },
        'Новая заявка: Zeekr 001, 2025.',
      ],
      [
        { title: 'Zeekr 001', budget: 1500.5 },
        'Новая заявка: Zeekr 001. Бюджет 1 500,50 ₽.',
      ],
      [{ title: 'Zeekr 001', comment: '   ' }, 'Новая заявка: Zeekr 001.'],
    ];
    for (const [payload, expected] of cases) {
      const { id } = await create(tokens.broker, payload);
      expect((await dialog(id, tokens.broker))[0].text).toBe(expected);
    }
  });

  it('works the same for an individual', async () => {
    const { id } = await create(tokens.individual, {
      title: 'Toyota RAV4',
      yearFrom: 2024,
      budget: 3_200_000,
    });
    const [first] = await dialog(id, tokens.individual);
    expect(first).toMatchObject({
      text: 'Новая заявка: Toyota RAV4, 2024. Бюджет 3 200 000 ₽.',
      author: { id: fx.individual.id, role: 'INDIVIDUAL' },
      isMine: true,
    });
  });

  it('is unread for the manager and already read for its author', async () => {
    const { id } = await create(tokens.broker, { title: 'BYD Song Plus' });

    const asClient = await call('GET', `/requests/${id}`, tokens.broker);
    expect(asClient.json<{ unreadCount: number }>().unreadCount).toBe(0);
    const asManager = await call('GET', `/requests/${id}`, tokens.admin);
    expect(asManager.json<{ unreadCount: number }>().unreadCount).toBe(1);

    // менеджер прочитал — счётчик сбросился
    await call('POST', `/requests/${id}/read`, tokens.admin);
    const after = await call('GET', `/requests/${id}`, tokens.admin);
    expect(after.json<{ unreadCount: number }>().unreadCount).toBe(0);
  });

  it('is shown to the manager as the first message and does not change the status', async () => {
    const { id } = await create(tokens.broker, { title: 'Li Auto L7' });
    expect(
      (await prisma.request.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('NEW');

    const items = await dialog(id, tokens.admin);
    expect(items).toHaveLength(1);
    expect(items[0].isMine).toBe(false);

    // первый ответ менеджера по-прежнему переводит заявку в диалог
    await call('POST', `/requests/${id}/messages`, tokens.admin, {
      text: 'Есть варианты',
    });
    expect(
      (await prisma.request.findUniqueOrThrow({ where: { id } })).status,
    ).toBe('IN_DIALOG');
    expect(await dialog(id, tokens.broker)).toHaveLength(2);
  });

  it('is not written for a refused request', async () => {
    const before = await prisma.message.count();
    const asAdmin = await call('POST', '/requests', tokens.admin, {
      title: 'Нельзя',
    });
    expect(asAdmin.statusCode).toBe(403);
    const invalid = await call('POST', '/requests', tokens.broker, {
      title: '',
    });
    expect(invalid.statusCode).toBe(400);
    expect(await prisma.message.count()).toBe(before);
  });

  it('stays hidden from other clients', async () => {
    const { id } = await create(tokens.broker, { title: 'Chery Tiggo 8 Pro' });
    const other = await accessTokenFor(app, fx.otherBroker.email);
    expect(
      (await call('GET', `/requests/${id}/messages`, other)).statusCode,
    ).toBe(404);
  });
});
