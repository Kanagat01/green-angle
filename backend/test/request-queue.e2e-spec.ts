import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  stepEvidence,
} from './helpers.js';

interface LastMessage {
  type: string;
  text: string | null;
  hasAttachments: boolean;
  author: 'CLIENT' | 'MANAGER' | 'SYSTEM';
}
interface RequestView {
  id: string;
  status: string;
  awaitingReply: boolean;
  lastMessage: LastMessage | null;
  unreadCount: number;
}

describe('Request queue data (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '', individual: '', otherBroker: '' };

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
  const newRequest = async (token = tokens.broker, title = 'Queue') => {
    const res = await call('POST', '/requests', token, {
      title: `${title} ${fx.tag}`,
    });
    expect(res.statusCode).toBe(201);
    return res.json<RequestView>().id;
  };
  const view = async (id: string, token = tokens.admin) =>
    (await call('GET', `/requests/${id}`, token)).json<RequestView>();
  const say = (id: string, token: string, text: string) =>
    call('POST', `/requests/${id}/messages`, token, { text });
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
  /** Сообщения идут с разным временем: иначе порядок «последнего» нельзя проверить */
  const tick = () => sleep(15);

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    fx = await createFixtures(prisma);
    tokens.admin = await accessTokenFor(app, fx.admin.email);
    tokens.broker = await accessTokenFor(app, fx.broker.email);
    tokens.individual = await accessTokenFor(app, fx.individual.email);
    tokens.otherBroker = await accessTokenFor(app, fx.otherBroker.email);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  describe('awaitingReply and lastMessage', () => {
    it('a new request waits for an answer, its last message is the client one', async () => {
      const id = await newRequest();
      const r = await view(id);
      expect(r.awaitingReply).toBe(true);
      expect(r.lastMessage).toMatchObject({
        type: 'TEXT',
        author: 'CLIENT',
        hasAttachments: false,
      });
      expect(r.lastMessage!.text).toContain('Новая заявка: Queue');
    });

    it('follows the conversation: manager answers, client replies again', async () => {
      const id = await newRequest();
      await tick();
      await say(id, tokens.admin, 'Есть два варианта');
      let r = await view(id);
      expect(r.awaitingReply).toBe(false);
      expect(r.lastMessage).toMatchObject({
        author: 'MANAGER',
        text: 'Есть два варианта',
      });

      await tick();
      await say(id, tokens.broker, 'Беру второй');
      r = await view(id);
      expect(r.awaitingReply).toBe(true);
      expect(r.lastMessage).toMatchObject({
        author: 'CLIENT',
        text: 'Беру второй',
      });
    });

    it('is the same for the client and for the manager', async () => {
      const id = await newRequest(tokens.individual);
      expect((await view(id, tokens.individual)).awaitingReply).toBe(true);
      expect((await view(id, tokens.admin)).awaitingReply).toBe(true);
    });

    it('stops waiting once the request is approved or rejected', async () => {
      const approved = await newRequest();
      await call('POST', `/admin/requests/${approved}/approve`, tokens.admin);
      const a = await view(approved);
      expect(a.awaitingReply).toBe(false);
      expect(a.lastMessage).toMatchObject({ author: 'SYSTEM' });

      const rejected = await newRequest();
      await call('POST', `/admin/requests/${rejected}/reject`, tokens.admin);
      const r = await view(rejected);
      expect(r.awaitingReply).toBe(false);
      expect(r.lastMessage).toMatchObject({
        author: 'SYSTEM',
        text: 'Менеджер отклонил заявку.',
      });
    });

    it('a system line does not make an open request wait or stop waiting', async () => {
      const id = await newRequest();
      await tick();
      await say(id, tokens.admin, 'Смотрим');
      await prisma.message.create({
        data: { requestId: id, type: 'SYSTEM', text: 'Служебное' },
      });
      // последнее — служебное: ответа никто не ждёт (как в макете)
      const r = await view(id);
      expect(r.awaitingReply).toBe(false);
      expect(r.lastMessage?.author).toBe('SYSTEM');
    });

    it('shows attachments of the last message, including a status comment', async () => {
      const created = await call('POST', '/requests', tokens.broker, {
        title: `Files ${fx.tag}`,
      });
      const requestId = created.json<{ id: string }>().id;
      const approved = await call(
        'POST',
        `/admin/requests/${requestId}/approve`,
        tokens.admin,
      );
      const vehicleId = approved.json<{ vehicle: { id: string } }>().vehicle.id;
      await tick();
      const res = await call(
        'POST',
        `/admin/vehicles/${vehicleId}/status`,
        tokens.admin,
        {
          step: 2,
          comment: 'Оплата получена',
          ...(await stepEvidence(app, fx.admin.id, 2)),
        },
      );
      expect(res.statusCode).toBe(200);

      const r = await view(requestId);
      expect(r.lastMessage).toMatchObject({
        type: 'TEXT',
        author: 'MANAGER',
        text: 'Оплата получена',
        hasAttachments: true,
      });
    });

    it('treats a voice message as having an attachment and no text', async () => {
      const id = await newRequest();
      await tick();
      const voice = await prisma.message.create({
        data: {
          requestId: id,
          authorId: fx.broker.id,
          type: 'VOICE',
          durationSec: 5,
        },
      });
      await prisma.attachment.create({
        data: {
          key: `audio/${fx.broker.id}/${voice.id}.webm`,
          mime: 'audio/webm',
          size: 10,
          kind: 'AUDIO',
          uploadedById: fx.broker.id,
          messageId: voice.id,
        },
      });
      const r = await view(id);
      expect(r.lastMessage).toMatchObject({
        type: 'VOICE',
        text: null,
        hasAttachments: true,
        author: 'CLIENT',
      });
    });

    it('cuts a long text to a preview', async () => {
      const id = await newRequest();
      await tick();
      await say(id, tokens.broker, 'я'.repeat(500));
      const r = await view(id);
      expect(r.lastMessage!.text).toHaveLength(200);
    });

    it('keeps requests of other clients out of the way', async () => {
      const id = await newRequest(tokens.broker);
      expect(
        (await call('GET', `/requests/${id}`, tokens.otherBroker)).statusCode,
      ).toBe(404);
    });
  });

  describe('kept by the database', () => {
    const state = (id: string) =>
      prisma.request.findUniqueOrThrow({
        where: { id },
        select: { awaitingReply: true, lastMessageAt: true },
      });

    it('recalculates when the last message is deleted', async () => {
      const id = await newRequest();
      await tick();
      const answer = await prisma.message.create({
        data: { requestId: id, authorId: fx.admin.id, text: 'Ответ' },
      });
      expect((await state(id)).awaitingReply).toBe(false);

      await prisma.message.delete({ where: { id: answer.id } });
      expect((await state(id)).awaitingReply).toBe(true);
    });

    it('says a request without messages waits, and has no last time', async () => {
      const id = await newRequest();
      await prisma.message.deleteMany({ where: { requestId: id } });
      const s = await state(id);
      expect(s).toEqual({ awaitingReply: true, lastMessageAt: null });
      expect((await view(id)).lastMessage).toBeNull();
    });

    it('closes the wait on any status change to a closed one', async () => {
      const id = await newRequest();
      expect((await state(id)).awaitingReply).toBe(true);
      await prisma.request.update({
        where: { id },
        data: { status: 'REJECTED' },
      });
      expect((await state(id)).awaitingReply).toBe(false);
    });

    it('moves lastMessageAt to the newest message', async () => {
      const id = await newRequest();
      const before = (await state(id)).lastMessageAt!;
      await tick();
      await say(id, tokens.admin, 'Позже');
      const after = (await state(id)).lastMessageAt!;
      expect(after.getTime()).toBeGreaterThan(before.getTime());
    });
  });

  describe('manager queue', () => {
    const queue = async (query = '') =>
      (
        await call(
          'GET',
          `/admin/requests?clientId=${fx.broker.clientId}${query}`,
          tokens.admin,
        )
      ).json<{ items: RequestView[]; total: number }>();

    it('puts waiting requests first, then the freshest conversations', async () => {
      const a = await newRequest(tokens.broker, 'A');
      await tick();
      const b = await newRequest(tokens.broker, 'B');
      await tick();
      const c = await newRequest(tokens.broker, 'C');
      await tick();
      await say(a, tokens.admin, 'Отвечаю по A'); // A больше не ждёт
      await tick();
      await say(c, tokens.admin, 'Отвечаю по C'); // и C тоже, свежее A

      const items = (await queue('&limit=100')).items;
      const mine = items.filter((r) => [a, b, c].includes(r.id));
      expect(mine.map((r) => r.id)).toEqual([b, c, a]);
      expect(mine.map((r) => r.awaitingReply)).toEqual([true, false, false]);
    });

    it('filters by awaiting', async () => {
      const waiting = await newRequest(tokens.broker, 'W');
      await tick();
      const answered = await newRequest(tokens.broker, 'N');
      await tick();
      await say(answered, tokens.admin, 'Готово');

      const only = await queue('&awaiting=true&limit=100');
      expect(only.items.every((r) => r.awaitingReply)).toBe(true);
      expect(only.items.map((r) => r.id)).toContain(waiting);
      expect(only.items.map((r) => r.id)).not.toContain(answered);

      const rest = await queue('&awaiting=false&limit=100');
      expect(rest.items.every((r) => !r.awaitingReply)).toBe(true);
      expect(rest.items.map((r) => r.id)).toContain(answered);

      expect(
        (await call('GET', '/admin/requests?awaiting=maybe', tokens.admin))
          .statusCode,
      ).toBe(400);
    });

    it('paginates the sorted queue without gaps or duplicates', async () => {
      const ids = new Set<string>();
      for (let i = 0; i < 4; i++) {
        ids.add(await newRequest(tokens.broker, `P${i}`));
        await tick();
      }
      const seen: string[] = [];
      for (let offset = 0; ; offset += 3) {
        const page = await queue(`&limit=3&offset=${offset}`);
        seen.push(...page.items.map((r) => r.id));
        if (offset + 3 >= page.total) break;
      }
      expect(new Set(seen).size).toBe(seen.length);
      for (const id of ids) expect(seen).toContain(id);
    });

    it('does not reorder the list of a client: newest request first', async () => {
      const first = await newRequest(tokens.individual, 'Old');
      await tick();
      const second = await newRequest(tokens.individual, 'New');
      await tick();
      await say(first, tokens.admin, 'Ответ на старую');
      const list = (
        await call('GET', '/requests?limit=100', tokens.individual)
      ).json<{ items: RequestView[] }>().items;
      const ours = list
        .map((r) => r.id)
        .filter((x) => [first, second].includes(x));
      expect(ours).toEqual([second, first]);
    });
  });

  describe('counters', () => {
    it('reports how many wait and how many there are in total', async () => {
      const id = await newRequest();
      const res = await call('GET', '/admin/requests/counts', tokens.admin);
      expect(res.statusCode).toBe(200);
      const counts = res.json<{ awaitingReply: number; total: number }>();
      expect(counts.awaitingReply).toBeGreaterThanOrEqual(1);
      expect(counts.total).toBeGreaterThanOrEqual(counts.awaitingReply);

      // Параллельные наборы тестов тоже создают заявки, поэтому точные числа по всей базе
      // проверять нельзя: убеждаемся, что именно наша заявка перестала ждать
      await say(id, tokens.admin, 'Ответ');
      expect((await view(id)).awaitingReply).toBe(false);
    });

    it('is for managers only', async () => {
      expect(
        (await call('GET', '/admin/requests/counts', tokens.broker)).statusCode,
      ).toBe(403);
    });
  });
});
