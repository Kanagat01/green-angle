import { hash } from '@node-rs/argon2';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  PASSWORD,
  transfer,
} from './helpers.js';

interface Message {
  id: string;
  requestId: string;
  type: string;
  text: string | null;
  links: string[];
  durationSec: number | null;
  attachments: { id: string; kind: string; url: string; size: number }[];
  author: { id: string; role: string };
  isMine: boolean;
  createdAt: string;
}
interface MessageList {
  items: Message[];
  hasMore: boolean;
}
interface RequestView {
  id: string;
  status: 'NEW' | 'IN_DIALOG' | 'APPROVED';
  unreadCount: number;
}

describe('Request dialog (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let fx: Fixtures;
  const tokens = {
    admin: '',
    admin2: '',
    broker: '',
    otherBroker: '',
    individual: '',
  };
  const s3Keys: string[] = [];

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

  /** Новая заявка клиента (создаётся самим клиентом через API). */
  async function newRequest(token = tokens.broker) {
    const res = await call('POST', '/requests', token, {
      title: `Dialog ${fx.tag}`,
    });
    expect(res.statusCode).toBe(201);
    return res.json<RequestView>().id;
  }

  const post = (reqId: string, token: string | null, payload: object) =>
    call('POST', `/requests/${reqId}/messages`, token, payload);
  const getRequest = async (reqId: string, token: string) =>
    (await call('GET', `/requests/${reqId}`, token)).json<RequestView>();

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    fx = await createFixtures(prisma);

    const second = await prisma.user.create({
      data: {
        email: `admin2-${fx.tag}@test.local`,
        passwordHash: await hash(PASSWORD),
        role: Role.ADMIN,
      },
    });

    tokens.admin = await accessTokenFor(app, fx.admin.email);
    tokens.admin2 = await accessTokenFor(app, second.email);
    tokens.broker = await accessTokenFor(app, fx.broker.email);
    tokens.otherBroker = await accessTokenFor(app, fx.otherBroker.email);
    tokens.individual = await accessTokenFor(app, fx.individual.email);
  });

  afterAll(async () => {
    await Promise.all(s3Keys.map((key) => storage.delete(key).catch(() => {})));
    await fx.cleanup();
    await app.close();
  });

  describe('posting messages', () => {
    it('lets the client write; the request stays NEW', async () => {
      const id = await newRequest();
      const res = await post(id, tokens.broker, {
        text: '  Нужен Chery Tiggo 8  ',
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<Message>()).toMatchObject({
        requestId: id,
        type: 'TEXT',
        text: 'Нужен Chery Tiggo 8',
        links: [],
        attachments: [],
        durationSec: null,
        isMine: true,
        author: { id: fx.broker.id, role: 'BROKER' },
      });
      expect((await getRequest(id, tokens.broker)).status).toBe('NEW');
    });

    it('moves NEW → IN_DIALOG on the first manager message only', async () => {
      const id = await newRequest();
      await post(id, tokens.broker, { text: 'Вопрос' });
      expect((await getRequest(id, tokens.admin)).status).toBe('NEW');

      const reply = await post(id, tokens.admin, { text: 'Здравствуйте!' });
      expect(reply.statusCode).toBe(201);
      expect(reply.json<Message>().author.role).toBe('ADMIN');
      expect((await getRequest(id, tokens.broker)).status).toBe('IN_DIALOG');

      // дальнейшие сообщения статус не меняют
      await post(id, tokens.broker, { text: 'Ответ клиента' });
      await post(id, tokens.admin, { text: 'Ещё одно' });
      expect((await getRequest(id, tokens.broker)).status).toBe('IN_DIALOG');
    });

    it('accepts links to listings (http/https)', async () => {
      const id = await newRequest();
      const links = [
        'https://auto.ru/cars/1',
        'http://example.com/listing?id=2',
      ];
      const res = await post(id, tokens.broker, { links });
      expect(res.statusCode).toBe(201);
      expect(res.json<Message>()).toMatchObject({ text: null, links });
    });

    it('rejects an empty message', async () => {
      const id = await newRequest();
      for (const payload of [
        {},
        { text: '' },
        { text: '   ' },
        { links: [], attachments: [] },
      ]) {
        expect((await post(id, tokens.broker, payload)).statusCode).toBe(400);
      }
    });

    it.each([
      ['javascript: link', { links: ['javascript:alert(1)'] }],
      ['ftp link', { links: ['ftp://example.com/file'] }],
      ['link without protocol', { links: ['example.com/x'] }],
      [
        'too many links',
        { links: Array.from({ length: 11 }, (_, i) => `https://e.com/${i}`) },
      ],
      ['non-array links', { links: 'https://e.com' }],
      ['text too long', { text: 'x'.repeat(5001) }],
      [
        'VOICE without attachmentKey and durationSec',
        { type: 'VOICE', text: 'x' },
      ],
      ['unknown type', { type: 'EMAIL', text: 'x' }],
      [
        'AUDIO attachment in a text message',
        { attachments: [{ key: 'audio/x/y.webm', kind: 'AUDIO' }] },
      ],
      [
        'too many attachments',
        {
          attachments: Array.from({ length: 11 }, (_, i) => ({
            key: `photo/x/${i}.jpg`,
            kind: 'PHOTO',
          })),
        },
      ],
    ])('rejects %s with 400', async (_name, payload) => {
      const id = await newRequest();
      expect((await post(id, tokens.broker, payload)).statusCode).toBe(400);
    });

    it('ignores client-supplied author and request fields', async () => {
      const id = await newRequest();
      const res = await post(id, tokens.broker, {
        text: 'spoof',
        authorId: fx.admin.id,
        requestId: '00000000-0000-4000-8000-000000000000',
        durationSec: 99,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<Message>()).toMatchObject({
        requestId: id,
        durationSec: null,
        author: { id: fx.broker.id },
      });
    });

    it('requires authentication', async () => {
      const id = await newRequest();
      expect((await post(id, null, { text: 'x' })).statusCode).toBe(401);
      expect(
        (await call('GET', `/requests/${id}/messages`, null)).statusCode,
      ).toBe(401);
    });
  });

  describe('read-only after approval', () => {
    it('forbids posting to an APPROVED request for both client and manager', async () => {
      const id = await newRequest();
      await post(id, tokens.broker, { text: 'до одобрения' });
      await prisma.request.update({
        where: { id },
        data: { status: 'APPROVED' },
      });

      expect(
        (await post(id, tokens.broker, { text: 'после' })).statusCode,
      ).toBe(409);
      expect((await post(id, tokens.admin, { text: 'после' })).statusCode).toBe(
        409,
      );
      expect(await prisma.message.count({ where: { requestId: id } })).toBe(1);
    });

    it('still lets everyone read and mark as read', async () => {
      const id = await newRequest();
      await post(id, tokens.broker, { text: 'сообщение' });
      await prisma.request.update({
        where: { id },
        data: { status: 'APPROVED' },
      });

      for (const token of [tokens.broker, tokens.admin]) {
        const res = await call('GET', `/requests/${id}/messages`, token);
        expect(res.statusCode).toBe(200);
        expect(res.json<MessageList>().items).toHaveLength(1);
      }
      expect(
        (await call('POST', `/requests/${id}/read`, tokens.admin)).statusCode,
      ).toBe(200);
    });
  });

  describe('access scope', () => {
    let id: string;

    beforeAll(async () => {
      id = await newRequest(tokens.broker);
      await post(id, tokens.broker, { text: 'секрет' });
    });

    it.each(['otherBroker', 'individual'] as const)(
      'returns 404 on every dialog route for %s',
      async (who) => {
        expect(
          (await call('GET', `/requests/${id}/messages`, tokens[who]))
            .statusCode,
        ).toBe(404);
        expect(
          (await post(id, tokens[who], { text: 'вторжение' })).statusCode,
        ).toBe(404);
        expect(
          (await call('POST', `/requests/${id}/read`, tokens[who])).statusCode,
        ).toBe(404);
      },
    );

    it('lets admin read and write in any client dialog', async () => {
      expect(
        (await call('GET', `/requests/${id}/messages`, tokens.admin))
          .statusCode,
      ).toBe(200);
      expect((await post(id, tokens.admin, { text: 'ответ' })).statusCode).toBe(
        201,
      );
    });

    it('returns 400 for a malformed id and 404 for an unknown one', async () => {
      expect(
        (await call('GET', '/requests/nope/messages', tokens.broker))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await call(
            'GET',
            '/requests/00000000-0000-4000-8000-000000000000/messages',
            tokens.broker,
          )
        ).statusCode,
      ).toBe(404);
    });
  });

  describe('message list', () => {
    let id: string;
    let expectedOrder: string[];

    beforeAll(async () => {
      id = await newRequest();
      for (let i = 1; i <= 7; i++) {
        await post(id, i % 2 ? tokens.broker : tokens.admin, {
          text: `msg ${i}`,
        });
      }
      const rows = await prisma.message.findMany({
        where: { requestId: id },
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        select: { id: true },
      });
      expectedOrder = rows.map((r) => r.id);
    });

    const page = async (query: string, token = tokens.broker) =>
      (
        await call('GET', `/requests/${id}/messages${query}`, token)
      ).json<MessageList>();

    it('returns messages from oldest to newest with isMine per viewer', async () => {
      const asBroker = await page('');
      expect(asBroker.items.map((m) => m.id)).toEqual(expectedOrder);
      expect(asBroker.hasMore).toBe(false);
      expect(asBroker.items.filter((m) => m.isMine).length).toBe(4);

      const asAdmin = await page('', tokens.admin);
      expect(asAdmin.items.filter((m) => m.isMine).length).toBe(3);
    });

    it('pages backwards with the before cursor without gaps or duplicates', async () => {
      const first = await page('?limit=3');
      expect(first.items.map((m) => m.id)).toEqual(expectedOrder.slice(4));
      expect(first.hasMore).toBe(true);

      const second = await page(`?limit=3&before=${first.items[0].id}`);
      expect(second.items.map((m) => m.id)).toEqual(expectedOrder.slice(1, 4));
      expect(second.hasMore).toBe(true);

      const third = await page(`?limit=3&before=${second.items[0].id}`);
      expect(third.items.map((m) => m.id)).toEqual(expectedOrder.slice(0, 1));
      expect(third.hasMore).toBe(false);
    });

    it('rejects an unknown cursor, a cursor from another request and bad limits', async () => {
      expect(
        (
          await call(
            'GET',
            `/requests/${id}/messages?before=00000000-0000-4000-8000-000000000000`,
            tokens.broker,
          )
        ).statusCode,
      ).toBe(400);

      const otherId = await newRequest();
      const foreign = (
        await post(otherId, tokens.broker, { text: 'x' })
      ).json<Message>();
      expect(
        (
          await call(
            'GET',
            `/requests/${id}/messages?before=${foreign.id}`,
            tokens.broker,
          )
        ).statusCode,
      ).toBe(400);

      expect(
        (await call('GET', `/requests/${id}/messages?limit=0`, tokens.broker))
          .statusCode,
      ).toBe(400);
      expect(
        (
          await call(
            'GET',
            `/requests/${id}/messages?before=bad`,
            tokens.broker,
          )
        ).statusCode,
      ).toBe(400);
    });
  });

  describe('unread counters', () => {
    it("counts only other people's messages and clears them on read", async () => {
      const id = await newRequest();
      await post(id, tokens.broker, { text: 'мой вопрос' });
      expect((await getRequest(id, tokens.broker)).unreadCount).toBe(0); // свои не считаются
      expect((await getRequest(id, tokens.admin)).unreadCount).toBe(1);

      await post(id, tokens.admin, { text: 'ответ 1' });
      await post(id, tokens.admin, { text: 'ответ 2' });
      expect((await getRequest(id, tokens.broker)).unreadCount).toBe(2);
      expect((await getRequest(id, tokens.admin)).unreadCount).toBe(1);

      const read = await call('POST', `/requests/${id}/read`, tokens.broker);
      expect(read.statusCode).toBe(200);
      expect(read.json()).toEqual({ unreadCount: 0 });
      expect((await getRequest(id, tokens.broker)).unreadCount).toBe(0);
      // у менеджера свой счётчик, он не затронут
      expect((await getRequest(id, tokens.admin)).unreadCount).toBe(1);
    });

    it('is idempotent and picks up messages that arrive afterwards', async () => {
      const id = await newRequest();
      await post(id, tokens.admin, { text: 'раз' });
      await call('POST', `/requests/${id}/read`, tokens.broker);
      await call('POST', `/requests/${id}/read`, tokens.broker);
      expect((await getRequest(id, tokens.broker)).unreadCount).toBe(0);

      await post(id, tokens.admin, { text: 'два' });
      expect((await getRequest(id, tokens.broker)).unreadCount).toBe(1);
    });

    it('is tracked per user, also between managers', async () => {
      const id = await newRequest();
      await post(id, tokens.broker, { text: 'вопрос' });
      expect((await getRequest(id, tokens.admin)).unreadCount).toBe(1);
      expect((await getRequest(id, tokens.admin2)).unreadCount).toBe(1);

      await call('POST', `/requests/${id}/read`, tokens.admin);
      expect((await getRequest(id, tokens.admin)).unreadCount).toBe(0);
      expect((await getRequest(id, tokens.admin2)).unreadCount).toBe(1);
    });

    it('is reported in request lists', async () => {
      const id = await newRequest();
      await post(id, tokens.admin, { text: 'в списке' });

      const mine = (
        await call('GET', '/requests?limit=200', tokens.broker)
      ).json<{
        items: (RequestView & { id: string })[];
      }>();
      expect(mine.items.find((r) => r.id === id)?.unreadCount).toBe(1);

      const queue = (
        await call('GET', '/admin/requests?limit=200', tokens.admin)
      ).json<{
        items: (RequestView & { id: string })[];
      }>();
      expect(queue.items.find((r) => r.id === id)?.unreadCount).toBe(0);
    });

    it('totals unread messages across the user requests only', async () => {
      const total = async (token: string) =>
        (await call('GET', '/requests/unread-count', token)).json<{
          unreadCount: number;
        }>().unreadCount;

      const before = await total(tokens.individual);
      const own = await newRequest(tokens.individual);
      await post(own, tokens.admin, { text: 'одному' });
      await post(own, tokens.admin, { text: 'второе' });

      // сообщения в чужой заявке брокера не попадают в счётчик физлица
      const brokerReq = await newRequest(tokens.broker);
      await post(brokerReq, tokens.admin, { text: 'другому' });

      expect(await total(tokens.individual)).toBe(before + 2);

      await call('POST', `/requests/${own}/read`, tokens.individual);
      expect(await total(tokens.individual)).toBe(before);
    });

    it('requires authentication for the total', async () => {
      expect(
        (await call('GET', '/requests/unread-count', null)).statusCode,
      ).toBe(401);
    });
  });

  describe('attachments (real storage)', () => {
    /** presign через API → PUT в хранилище → ключ */
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
      const put = await transfer(app, t.uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: t.headers,
      });
      expect(put.ok).toBe(true);
      return t.key;
    }

    it('attaches photos and links as listing variants', async () => {
      const id = await newRequest();
      const bytes = new TextEncoder().encode('photo-of-listing');
      const key = await uploadAs(tokens.broker, 'PHOTO', 'image/jpeg', bytes);

      const res = await post(id, tokens.broker, {
        text: 'Вот вариант',
        links: ['https://auto.ru/cars/42'],
        attachments: [{ key, kind: 'PHOTO' }],
      });
      expect(res.statusCode).toBe(201);
      const msg = res.json<Message>();
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0]).toMatchObject({
        kind: 'PHOTO',
        size: bytes.length,
      });

      // менеджер видит вложение в ленте и может скачать
      const list = (
        await call('GET', `/requests/${id}/messages`, tokens.admin)
      ).json<MessageList>();
      const download = await transfer(app, list.items[0].attachments[0].url);
      expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
    });

    it('creates nothing when any attachment is invalid (atomic)', async () => {
      const id = await newRequest();
      const good = await uploadAs(
        tokens.broker,
        'PHOTO',
        'image/png',
        new Uint8Array(8),
      );
      const missing = `photo/${fx.broker.id}/${randomUUID()}.jpg`;

      const res = await post(id, tokens.broker, {
        text: 'с битым вложением',
        attachments: [
          { key: good, kind: 'PHOTO' },
          { key: missing, kind: 'PHOTO' },
        ],
      });
      expect(res.statusCode).toBe(400);
      expect(await prisma.message.count({ where: { requestId: id } })).toBe(0);
      expect(await prisma.attachment.count({ where: { key: good } })).toBe(0);
    });

    it("rejects another user's key and an already used key", async () => {
      const id = await newRequest();
      const foreign = await uploadAs(
        tokens.otherBroker,
        'PHOTO',
        'image/png',
        new Uint8Array(8),
      );
      expect(
        (
          await post(id, tokens.broker, {
            attachments: [{ key: foreign, kind: 'PHOTO' }],
          })
        ).statusCode,
      ).toBe(400);

      const own = await uploadAs(
        tokens.broker,
        'PHOTO',
        'image/png',
        new Uint8Array(8),
      );
      expect(
        (
          await post(id, tokens.broker, {
            attachments: [{ key: own, kind: 'PHOTO' }],
          })
        ).statusCode,
      ).toBe(201);
      expect(
        (
          await post(id, tokens.broker, {
            attachments: [{ key: own, kind: 'PHOTO' }],
          })
        ).statusCode,
      ).toBe(409);
      expect(
        (
          await post(id, tokens.broker, {
            attachments: [
              { key: own, kind: 'PHOTO' },
              { key: own, kind: 'PHOTO' },
            ],
          })
        ).statusCode,
      ).toBe(400);
    });

    it('does not attach to an approved request', async () => {
      const id = await newRequest();
      const key = await uploadAs(
        tokens.broker,
        'PHOTO',
        'image/png',
        new Uint8Array(8),
      );
      await prisma.request.update({
        where: { id },
        data: { status: 'APPROVED' },
      });
      const res = await post(id, tokens.broker, {
        attachments: [{ key, kind: 'PHOTO' }],
      });
      expect(res.statusCode).toBe(409);
      expect(await prisma.attachment.count({ where: { key } })).toBe(0);
    });
  });
});
