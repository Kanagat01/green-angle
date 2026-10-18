import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
} from './helpers.js';

interface Ticket {
  key: string;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  expiresIn: number;
}
interface Message {
  id: string;
  type: 'TEXT' | 'VOICE';
  text: string | null;
  links: string[];
  durationSec: number | null;
  attachments: {
    id: string;
    kind: string;
    mime: string;
    size: number;
    url: string;
  }[];
  author: { role: string };
  isMine: boolean;
}
interface RequestView {
  id: string;
  status: 'NEW' | 'IN_DIALOG' | 'APPROVED';
  unreadCount: number;
}

const s3Up = await fetch(process.env.S3_ENDPOINT!, {
  signal: AbortSignal.timeout(2000),
})
  .then(() => true)
  .catch(() => false);

describe('Voice messages (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '', otherBroker: '', individual: '' };
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

  async function newRequest(token = tokens.broker) {
    const res = await call('POST', '/requests', token, {
      title: `Voice ${fx.tag}`,
    });
    expect(res.statusCode).toBe(201);
    return res.json<RequestView>().id;
  }

  const voiceUrl = (reqId: string, token: string | null, payload: object) =>
    call('POST', `/requests/${reqId}/voice-upload-url`, token, payload);
  const postMessage = (reqId: string, token: string, payload: object) =>
    call('POST', `/requests/${reqId}/messages`, token, payload);

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

  describe('POST /requests/:id/voice-upload-url', () => {
    it('issues an audio ticket scoped to the user', async () => {
      const id = await newRequest();
      const res = await voiceUrl(id, tokens.broker, {
        mime: 'audio/webm;codecs=opus',
        size: 40_000,
      });
      expect(res.statusCode).toBe(200);
      const ticket = res.json<Ticket>();
      expect(ticket.method).toBe('PUT');
      expect(ticket.key).toMatch(
        new RegExp(`^audio/${fx.broker.id}/[0-9a-f-]{36}\\.webm$`),
      );
      expect(ticket.headers).toEqual({ 'Content-Type': 'audio/webm' });
    });

    it.each([
      ['audio/webm', 'webm'],
      ['audio/ogg', 'ogg'],
      ['audio/mp4', 'm4a'],
      ['audio/mpeg', 'mp3'],
      ['audio/wav', 'wav'],
    ])('accepts %s (PLAN.md §5)', async (mime, ext) => {
      const id = await newRequest();
      const res = await voiceUrl(id, tokens.broker, { mime, size: 1000 });
      expect(res.statusCode).toBe(200);
      expect(res.json<Ticket>().key.endsWith(`.${ext}`)).toBe(true);
    });

    it('lets the manager get a ticket for a client dialog', async () => {
      const id = await newRequest();
      const res = await voiceUrl(id, tokens.admin, {
        mime: 'audio/ogg',
        size: 1000,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<Ticket>().key).toContain(`audio/${fx.admin.id}/`);
    });

    it('rejects non-audio formats with 415 and oversize files with 413', async () => {
      const id = await newRequest();
      for (const mime of ['image/png', 'video/mp4', 'text/html']) {
        expect(
          (await voiceUrl(id, tokens.broker, { mime, size: 1000 })).statusCode,
        ).toBe(415);
      }
      expect(
        (
          await voiceUrl(id, tokens.broker, {
            mime: 'audio/webm',
            size: 10 * 1024 * 1024 + 1,
          })
        ).statusCode,
      ).toBe(413);
      expect(
        (
          await voiceUrl(id, tokens.broker, {
            mime: 'audio/webm',
            size: 10 * 1024 * 1024,
          })
        ).statusCode,
      ).toBe(200);
    });

    it('validates the payload', async () => {
      const id = await newRequest();
      for (const payload of [
        {},
        { mime: 'audio/webm' },
        { mime: 'audio/webm', size: 0 },
        { mime: 'audio/webm', size: 'x' },
      ]) {
        expect((await voiceUrl(id, tokens.broker, payload)).statusCode).toBe(
          400,
        );
      }
    });

    it("hides other clients' requests (404) and requires auth", async () => {
      const id = await newRequest();
      const payload = { mime: 'audio/webm', size: 1000 };
      expect((await voiceUrl(id, tokens.otherBroker, payload)).statusCode).toBe(
        404,
      );
      expect((await voiceUrl(id, tokens.individual, payload)).statusCode).toBe(
        404,
      );
      expect((await voiceUrl(id, null, payload)).statusCode).toBe(401);
    });

    it('refuses a ticket for an approved request', async () => {
      const id = await newRequest();
      await prisma.request.update({
        where: { id },
        data: { status: 'APPROVED' },
      });
      expect(
        (await voiceUrl(id, tokens.broker, { mime: 'audio/webm', size: 1000 }))
          .statusCode,
      ).toBe(409);
    });
  });

  describe('creating VOICE messages: validation (no S3 needed)', () => {
    const key = () => `audio/${fx.broker.id}/${randomUUID()}.webm`;

    it.each([
      ['missing attachmentKey', { type: 'VOICE', durationSec: 10 }],
      [
        'missing durationSec',
        { type: 'VOICE', attachmentKey: 'audio/x/y.webm' },
      ],
      [
        'zero duration',
        { type: 'VOICE', attachmentKey: 'audio/x/y.webm', durationSec: 0 },
      ],
      [
        'duration over 5 minutes',
        { type: 'VOICE', attachmentKey: 'audio/x/y.webm', durationSec: 301 },
      ],
      [
        'fractional duration',
        { type: 'VOICE', attachmentKey: 'audio/x/y.webm', durationSec: 1.5 },
      ],
      [
        'string duration',
        { type: 'VOICE', attachmentKey: 'audio/x/y.webm', durationSec: '10' },
      ],
      ['empty key', { type: 'VOICE', attachmentKey: '', durationSec: 10 }],
    ])('rejects %s with 400', async (_name, payload) => {
      const id = await newRequest();
      expect((await postMessage(id, tokens.broker, payload)).statusCode).toBe(
        400,
      );
    });

    it('rejects text, links or attachments mixed into a voice message', async () => {
      const id = await newRequest();
      const base = { type: 'VOICE', attachmentKey: key(), durationSec: 10 };
      for (const extra of [
        { text: 'hello' },
        { links: ['https://auto.ru/1'] },
        { attachments: [{ key: 'photo/x/y.jpg', kind: 'PHOTO' }] },
      ]) {
        expect(
          (await postMessage(id, tokens.broker, { ...base, ...extra }))
            .statusCode,
        ).toBe(400);
      }
    });

    it('rejects an object that was never uploaded and creates nothing', async () => {
      const id = await newRequest();
      const res = await postMessage(id, tokens.broker, {
        type: 'VOICE',
        attachmentKey: key(),
        durationSec: 10,
      });
      expect(res.statusCode).toBe(400);
      expect(await prisma.message.count({ where: { requestId: id } })).toBe(0);
    });

    it("rejects someone else's key and a key of another kind", async () => {
      const id = await newRequest();
      const foreign = `audio/${fx.otherBroker.id}/${randomUUID()}.webm`;
      const photo = `photo/${fx.broker.id}/${randomUUID()}.jpg`;
      for (const attachmentKey of [foreign, photo]) {
        const res = await postMessage(id, tokens.broker, {
          type: 'VOICE',
          attachmentKey,
          durationSec: 10,
        });
        expect(res.statusCode).toBe(400);
      }
    });

    it('still ignores voice-only fields in a TEXT message', async () => {
      const id = await newRequest();
      const res = await postMessage(id, tokens.broker, {
        text: 'просто текст',
        attachmentKey: 'audio/x/y.webm',
        durationSec: 99,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<Message>()).toMatchObject({
        type: 'TEXT',
        durationSec: null,
        attachments: [],
      });
    });

    it('refuses a voice message in an approved request', async () => {
      const id = await newRequest();
      await prisma.request.update({
        where: { id },
        data: { status: 'APPROVED' },
      });
      const res = await postMessage(id, tokens.broker, {
        type: 'VOICE',
        attachmentKey: key(),
        durationSec: 10,
      });
      expect(res.statusCode).toBe(409);
    });
  });

  describe.runIf(s3Up || !!process.env.CI)('full flow with real S3', () => {
    /** voice-upload-url → PUT в S3 → ключ */
    async function uploadVoice(
      reqId: string,
      token: string,
      mime: string,
      bytes: Uint8Array,
    ) {
      const res = await voiceUrl(reqId, token, { mime, size: bytes.length });
      expect(res.statusCode).toBe(200);
      const t = res.json<Ticket>();
      s3Keys.push(t.key);
      const put = await fetch(t.uploadUrl, {
        method: 'PUT',
        body: bytes as BodyInit,
        headers: t.headers,
      });
      expect(put.ok).toBe(true);
      return t.key;
    }

    it('client records a voice note, the manager plays it back and answers with voice', async () => {
      const id = await newRequest();
      const clientAudio = new TextEncoder().encode('client-opus-recording');
      const key = await uploadVoice(
        id,
        tokens.broker,
        'audio/webm;codecs=opus',
        clientAudio,
      );

      const sent = await postMessage(id, tokens.broker, {
        type: 'VOICE',
        attachmentKey: key,
        durationSec: 42,
      });
      expect(sent.statusCode).toBe(201);
      const msg = sent.json<Message>();
      expect(msg).toMatchObject({
        type: 'VOICE',
        text: null,
        links: [],
        durationSec: 42,
        isMine: true,
        author: { role: 'BROKER' },
      });
      expect(msg.attachments).toHaveLength(1);
      expect(msg.attachments[0]).toMatchObject({
        kind: 'AUDIO',
        mime: 'audio/webm',
        size: clientAudio.length,
      });

      // менеджер получает сообщение со ссылкой воспроизведения (GET presign) и слушает
      const list = (
        await call('GET', `/requests/${id}/messages`, tokens.admin)
      ).json<{
        items: Message[];
      }>();
      expect(list.items).toHaveLength(1);
      expect(list.items[0].isMine).toBe(false);
      const playback = await fetch(list.items[0].attachments[0].url);
      expect(playback.ok).toBe(true);
      expect(new Uint8Array(await playback.arrayBuffer())).toEqual(clientAudio);

      // непрочитанное считается и для голосовых
      const unread = (
        await call('GET', `/requests/${id}`, tokens.admin)
      ).json<RequestView>();
      expect(unread.unreadCount).toBe(1);

      // ответ менеджера голосовым переводит заявку NEW → IN_DIALOG
      expect(
        (await call('GET', `/requests/${id}`, tokens.admin)).json<RequestView>()
          .status,
      ).toBe('NEW');
      const replyKey = await uploadVoice(
        id,
        tokens.admin,
        'audio/ogg',
        new Uint8Array(16),
      );
      const reply = await postMessage(id, tokens.admin, {
        type: 'VOICE',
        attachmentKey: replyKey,
        durationSec: 7,
      });
      expect(reply.statusCode).toBe(201);
      expect(reply.json<Message>()).toMatchObject({
        type: 'VOICE',
        author: { role: 'ADMIN' },
      });
      expect(
        (
          await call('GET', `/requests/${id}`, tokens.broker)
        ).json<RequestView>().status,
      ).toBe('IN_DIALOG');
    });

    it('accepts the maximum duration of 5 minutes', async () => {
      const id = await newRequest();
      const key = await uploadVoice(
        id,
        tokens.broker,
        'audio/mp4',
        new Uint8Array(32),
      );
      const res = await postMessage(id, tokens.broker, {
        type: 'VOICE',
        attachmentKey: key,
        durationSec: 300,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<Message>().attachments[0].mime).toBe('audio/mp4');
    });

    it('cannot reuse the same recording in a second message', async () => {
      const id = await newRequest();
      const key = await uploadVoice(
        id,
        tokens.broker,
        'audio/wav',
        new Uint8Array(32),
      );
      const payload = { type: 'VOICE', attachmentKey: key, durationSec: 5 };
      expect((await postMessage(id, tokens.broker, payload)).statusCode).toBe(
        201,
      );
      expect((await postMessage(id, tokens.broker, payload)).statusCode).toBe(
        409,
      );
      expect(await prisma.message.count({ where: { requestId: id } })).toBe(1);
    });

    it('does not let a user reference a recording uploaded by someone else', async () => {
      const id = await newRequest();
      const adminKey = await uploadVoice(
        id,
        tokens.admin,
        'audio/ogg',
        new Uint8Array(16),
      );
      const res = await postMessage(id, tokens.broker, {
        type: 'VOICE',
        attachmentKey: adminKey,
        durationSec: 5,
      });
      expect(res.statusCode).toBe(400);
    });

    it('is blocked if the request gets approved between upload and send', async () => {
      const id = await newRequest();
      const key = await uploadVoice(
        id,
        tokens.broker,
        'audio/webm',
        new Uint8Array(16),
      );
      await prisma.request.update({
        where: { id },
        data: { status: 'APPROVED' },
      });
      const res = await postMessage(id, tokens.broker, {
        type: 'VOICE',
        attachmentKey: key,
        durationSec: 5,
      });
      expect(res.statusCode).toBe(409);
      expect(await prisma.attachment.count({ where: { key } })).toBe(0);
    });
  });
});
