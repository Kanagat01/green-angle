import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { randomUUID } from 'node:crypto';
import {
  AudioProbeError,
  AudioProbeService,
} from '../src/audio/audio-probe.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  audioFixture,
  AudioFormat,
  MIME_OF,
  videoWithAudioMp4,
  wavBuffer,
} from './audio-fixtures.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  transfer,
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
    const id = res.json<RequestView>().id;
    // Здесь проверяются голосовые; первое сообщение заявки — в request-first-message
    await prisma.message.deleteMany({ where: { requestId: id } });
    return id;
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

  describe('creating VOICE messages: validation (no storage needed)', () => {
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

  describe('full flow with real storage', () => {
    /** voice-upload-url → PUT в хранилище → ключ */
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
      const put = await transfer(app, t.uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: t.headers,
      });
      expect(put.ok).toBe(true);
      return t.key;
    }

    it('client records a voice note, the manager plays it back and answers with voice', async () => {
      const id = await newRequest();
      // как у MediaRecorder в Chrome: webm/opus без длительности в заголовке
      const clientAudio = await audioFixture('webm', 3);
      const key = await uploadVoice(
        id,
        tokens.broker,
        'audio/webm;codecs=opus',
        clientAudio,
      );

      const sent = await postMessage(id, tokens.broker, {
        type: 'VOICE',
        attachmentKey: key,
        durationSec: 3,
      });
      expect(sent.statusCode).toBe(201);
      const msg = sent.json<Message>();
      expect(msg).toMatchObject({
        type: 'VOICE',
        text: null,
        links: [],
        durationSec: 3,
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
      const playback = await transfer(app, list.items[0].attachments[0].url);
      expect(playback.ok).toBe(true);
      expect(
        Buffer.from(await playback.arrayBuffer()).equals(clientAudio),
      ).toBe(true);

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
        await audioFixture('ogg', 2),
      );
      const reply = await postMessage(id, tokens.admin, {
        type: 'VOICE',
        attachmentKey: replyKey,
        durationSec: 2,
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

    it('accepts a recording of exactly 5 minutes', async () => {
      const id = await newRequest();
      const key = await uploadVoice(
        id,
        tokens.broker,
        'audio/wav',
        wavBuffer(300),
      );
      const res = await postMessage(id, tokens.broker, {
        type: 'VOICE',
        attachmentKey: key,
        durationSec: 300,
      });
      expect(res.statusCode).toBe(201);
      expect(res.json<Message>()).toMatchObject({ durationSec: 300 });
      expect(res.json<Message>().attachments[0].mime).toBe('audio/wav');
    });

    it('cannot reuse the same recording in a second message', async () => {
      const id = await newRequest();
      const key = await uploadVoice(
        id,
        tokens.broker,
        'audio/wav',
        wavBuffer(1),
      );
      const payload = { type: 'VOICE', attachmentKey: key, durationSec: 1 };
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
        await audioFixture('ogg', 2),
      );
      const res = await postMessage(id, tokens.broker, {
        type: 'VOICE',
        attachmentKey: adminKey,
        durationSec: 2,
      });
      expect(res.statusCode).toBe(400);
    });

    it('is blocked if the request gets approved between upload and send', async () => {
      const id = await newRequest();
      const key = await uploadVoice(
        id,
        tokens.broker,
        'audio/webm',
        await audioFixture('webm', 2),
      );
      await prisma.request.update({
        where: { id },
        data: { status: 'APPROVED' },
      });
      const res = await postMessage(id, tokens.broker, {
        type: 'VOICE',
        attachmentKey: key,
        durationSec: 2,
      });
      expect(res.statusCode).toBe(409);
      expect(await prisma.attachment.count({ where: { key } })).toBe(0);
    });

    describe('server-side duration verification (ffprobe)', () => {
      /** Загружает файл, пробует отправить голосовое и возвращает ответ + число сообщений. */
      async function send(
        mime: string,
        bytes: Uint8Array,
        durationSec: number,
        token = tokens.broker,
      ) {
        const id = await newRequest();
        const key = await uploadVoice(id, token, mime, bytes);
        const res = await postMessage(id, token, {
          type: 'VOICE',
          attachmentKey: key,
          durationSec,
        });
        return {
          res,
          messages: await prisma.message.count({ where: { requestId: id } }),
          attachments: await prisma.attachment.count({ where: { key } }),
        };
      }

      it.each<[AudioFormat, number]>([
        ['webm', 3],
        ['webm-with-duration', 3],
        ['ogg', 3],
        ['mp4', 3],
        ['mp4-fragmented', 3],
        ['mp3', 3],
        ['wav', 3],
      ])(
        'accepts a real %s recording and stores the measured length',
        async (format) => {
          const audio = await audioFixture(format, 3);
          const { res } = await send(MIME_OF[format], audio, 3);
          expect(res.statusCode).toBe(201);
          expect(res.json<Message>()).toMatchObject({
            type: 'VOICE',
            durationSec: 3,
          });
        },
      );

      it('stores the measured duration, not the claimed one, when they differ within tolerance', async () => {
        const { res } = await send('audio/wav', wavBuffer(5), 6);
        expect(res.statusCode).toBe(201);
        expect(res.json<Message>().durationSec).toBe(5);
      });

      it('rejects a claimed duration far from the real one', async () => {
        const { res, messages, attachments } = await send(
          'audio/wav',
          wavBuffer(3),
          60,
        );
        expect(res.statusCode).toBe(400);
        expect(res.json<{ message: string }>().message).toContain(
          'does not match',
        );
        expect(messages).toBe(0);
        expect(attachments).toBe(0);
      });

      it('rejects the opposite lie: a long file claimed to be short', async () => {
        const { res } = await send('audio/wav', wavBuffer(120), 10);
        expect(res.statusCode).toBe(400);
      });

      it('enforces the 5-minute limit on the real duration, even when the claim says 300', async () => {
        const { res, messages, attachments } = await send(
          'audio/wav',
          wavBuffer(310),
          300,
        );
        expect(res.statusCode).toBe(400);
        expect(res.json<{ message: string }>().message).toContain(
          'longer than 300',
        );
        expect(messages).toBe(0);
        expect(attachments).toBe(0);
      });

      it('rejects bytes that are not audio although the mime type says so', async () => {
        const garbage = new Uint8Array(2048).map((_, i) => (i * 31) % 251);
        for (const mime of [
          'audio/webm',
          'audio/ogg',
          'audio/mp4',
          'audio/mpeg',
          'audio/wav',
        ]) {
          const { res, messages, attachments } = await send(mime, garbage, 5);
          expect(res.statusCode).toBe(400);
          expect(res.json<{ message: string }>().message).toContain(
            'not a valid audio',
          );
          expect(messages).toBe(0);
          expect(attachments).toBe(0);
        }
      });

      it('rejects a video file uploaded as audio/mp4', async () => {
        const { res, attachments } = await send(
          'audio/mp4',
          await videoWithAudioMp4(2),
          2,
        );
        expect(res.statusCode).toBe(400);
        expect(attachments).toBe(0);
      });

      it('rejects audio whose real format does not match the declared mime', async () => {
        const { res } = await send('audio/mpeg', wavBuffer(3), 3);
        expect(res.statusCode).toBe(400);
      });

      it('answers 503, not 400, when ffprobe itself is unavailable, and registers nothing', async () => {
        vi.spyOn(
          app.get(AudioProbeService),
          'measureObject',
        ).mockRejectedValueOnce(
          new AudioProbeError('UNAVAILABLE', 'ffprobe cannot be executed'),
        );
        const { res, messages, attachments } = await send(
          'audio/wav',
          wavBuffer(2),
          2,
        );
        expect(res.statusCode).toBe(503);
        expect(messages).toBe(0);
        expect(attachments).toBe(0);
      });

      it('applies to the manager too', async () => {
        const ok = await send(
          'audio/ogg',
          await audioFixture('ogg', 2),
          2,
          tokens.admin,
        );
        expect(ok.res.statusCode).toBe(201);
        const lie = await send(
          'audio/ogg',
          await audioFixture('ogg', 2),
          90,
          tokens.admin,
        );
        expect(lie.res.statusCode).toBe(400);
      });
    });
  });
});
