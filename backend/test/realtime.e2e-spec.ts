import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { JwtService } from '@nestjs/jwt';
import { io, Socket } from 'socket.io-client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { wavBuffer } from './audio-fixtures.js';
import type {
  MessageCreatedPayload,
  RequestUpdatedPayload,
  VehicleStatusChangedPayload,
} from '../src/realtime/realtime.events.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  login,
  randomVin,
  transfer,
} from './helpers.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Серверные события и типы их полезной нагрузки — те же, что использует сервер. */
interface EventMap {
  'message.created': MessageCreatedPayload;
  'request.updated': RequestUpdatedPayload;
  'vehicle.status_changed': VehicleStatusChangedPayload;
}
type EventName = keyof EventMap;
const EVENTS: EventName[] = [
  'message.created',
  'request.updated',
  'vehicle.status_changed',
];

/** Подключённый сокет, записывающий все серверные события. */
class Client {
  private readonly received: { name: EventName; payload: unknown }[] = [];

  constructor(readonly socket: Socket) {
    for (const name of EVENTS) {
      socket.on(name, (payload: unknown) =>
        this.received.push({ name, payload }),
      );
    }
  }

  of<K extends EventName>(
    name: K,
    predicate: (p: EventMap[K]) => boolean = () => true,
  ): EventMap[K][] {
    return this.received
      .filter((e) => e.name === name)
      .map((e) => e.payload as EventMap[K])
      .filter(predicate);
  }

  async waitFor<K extends EventName>(
    name: K,
    predicate: (p: EventMap[K]) => boolean = () => true,
    timeoutMs = 3000,
  ): Promise<EventMap[K]> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const found = this.of(name, predicate)[0];
      if (found) return found;
      await sleep(20);
    }
    throw new Error(`Timed out waiting for "${name}"`);
  }

  /** Убеждается, что событие не пришло (ждём заведомо дольше, чем доставка в тестовом окружении). */
  async expectNone<K extends EventName>(
    name: K,
    predicate: (p: EventMap[K]) => boolean = () => true,
    ms = 400,
  ) {
    await sleep(ms);
    expect(this.of(name, predicate)).toHaveLength(0);
  }

  join(requestId: string) {
    return this.socket.timeout(2000).emitWithAck('request.join', { requestId });
  }
  leave(requestId: string) {
    return this.socket
      .timeout(2000)
      .emitWithAck('request.leave', { requestId });
  }
}

describe('Realtime (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  let url: string;
  const tokens = { admin: '', broker: '', otherBroker: '', individual: '' };
  const clients: Client[] = [];
  const s3Keys: string[] = [];

  function connect(token: string | undefined, via: 'auth' | 'header' = 'auth') {
    return new Promise<Client>((resolve, reject) => {
      const socket = io(url, {
        transports: ['websocket'],
        reconnection: false,
        ...(via === 'auth'
          ? { auth: token ? { token } : {} }
          : { extraHeaders: { authorization: `Bearer ${token}` } }),
      });
      socket.once('connect', () => {
        const client = new Client(socket);
        clients.push(client);
        resolve(client);
      });
      socket.once('connect_error', (err) => {
        socket.close();
        reject(err);
      });
    });
  }

  const http = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    token: string,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: { authorization: `Bearer ${token}` },
      payload,
    });

  async function newRequest(token = tokens.broker) {
    const res = await http('POST', '/requests', token, {
      title: `RT ${fx.tag}`,
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }

  beforeAll(async () => {
    app = await createApp({ listen: true });
    url = await app.getUrl();
    prisma = app.get(PrismaService);
    fx = await createFixtures(prisma);
    tokens.admin = await accessTokenFor(app, fx.admin.email);
    tokens.broker = await accessTokenFor(app, fx.broker.email);
    tokens.otherBroker = await accessTokenFor(app, fx.otherBroker.email);
    tokens.individual = await accessTokenFor(app, fx.individual.email);
  });

  afterEach(() => {
    while (clients.length) clients.pop()!.socket.close();
  });

  afterAll(async () => {
    const storage = app.get(StorageService);
    await Promise.all(
      s3Keys.map((key) => storage.delete(key).catch(() => undefined)),
    );
    await fx.cleanup();
    await app.close();
  });

  describe('authentication', () => {
    it('accepts a valid access token (handshake auth and Authorization header)', async () => {
      const a = await connect(tokens.broker);
      const b = await connect(tokens.admin, 'header');
      expect(a.socket.connected).toBe(true);
      expect(b.socket.connected).toBe(true);
    });

    it.each([
      ['no token', undefined],
      ['garbage token', 'not.a.jwt'],
      ['tampered signature', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.AAAA'],
    ])('rejects %s', async (_name, token) => {
      await expect(connect(token)).rejects.toThrow('unauthorized');
    });

    it('rejects a refresh token used as an access token', async () => {
      const res = await login(app, fx.broker.email);
      const { refreshToken } = res.json<{ refreshToken: string }>();
      await expect(connect(refreshToken)).rejects.toThrow('unauthorized');
    });

    it('rejects an already expired token', async () => {
      const jwt = app.get(JwtService);
      const expired = await jwt.signAsync(
        { sub: fx.broker.id, role: 'BROKER', clientId: fx.broker.clientId },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: -10 },
      );
      await expect(connect(expired)).rejects.toThrow('unauthorized');
    });

    it('disconnects the socket when its token expires', async () => {
      const jwt = app.get(JwtService);
      const shortLived = await jwt.signAsync(
        { sub: fx.broker.id, role: 'BROKER', clientId: fx.broker.clientId },
        { secret: process.env.JWT_ACCESS_SECRET, expiresIn: 1 },
      );
      const client = await connect(shortLived);
      const reason = await new Promise<string>((resolve) =>
        client.socket.once('disconnect', resolve),
      );
      expect(reason).toBe('io server disconnect');
    }, 6000);
  });

  describe('request rooms', () => {
    it('lets a client join its own request room and refuses foreign or invalid ones', async () => {
      const id = await newRequest(tokens.broker);
      const broker = await connect(tokens.broker);
      const other = await connect(tokens.otherBroker);
      const person = await connect(tokens.individual);
      const admin = await connect(tokens.admin);

      expect(await broker.join(id)).toEqual({ ok: true });
      expect(await admin.join(id)).toEqual({ ok: true });
      expect(await other.join(id)).toEqual({ ok: false, error: 'NOT_FOUND' });
      expect(await person.join(id)).toEqual({ ok: false, error: 'NOT_FOUND' });
      expect(await broker.join('nope')).toEqual({
        ok: false,
        error: 'BAD_REQUEST',
      });
      expect(await broker.join('00000000-0000-4000-8000-000000000000')).toEqual(
        { ok: false, error: 'NOT_FOUND' },
      );
    });

    it('delivers message.created to the dialog participants only', async () => {
      const id = await newRequest(tokens.broker);
      const broker = await connect(tokens.broker);
      const admin = await connect(tokens.admin);
      const other = await connect(tokens.otherBroker);
      await broker.join(id);
      await admin.join(id);
      await other.join(id); // отказ — комнату не получил

      const res = await http(
        'POST',
        `/requests/${id}/messages`,
        tokens.broker,
        {
          text: 'Нужен Tiggo 8',
          links: ['https://auto.ru/1'],
        },
      );
      expect(res.statusCode).toBe(201);
      const created = res.json<{ id: string }>();

      for (const c of [broker, admin]) {
        const payload = await c.waitFor('message.created');
        expect(payload.message).toMatchObject({
          id: created.id,
          requestId: id,
          type: 'TEXT',
          text: 'Нужен Tiggo 8',
          links: ['https://auto.ru/1'],
          author: { id: fx.broker.id, role: 'BROKER' },
        });
        // сообщение общее для всех получателей — персональных полей в нём нет
        expect(payload.message).not.toHaveProperty('isMine');
        expect(c.of('message.created')).toHaveLength(1);
      }
      await other.expectNone('message.created');
    });

    it('does not send message.created to sockets that have not joined the request room', async () => {
      const id = await newRequest(tokens.broker);
      const joined = await connect(tokens.broker);
      const notJoined = await connect(tokens.broker);
      await joined.join(id);

      await http('POST', `/requests/${id}/messages`, tokens.admin, {
        text: 'ответ',
      });
      await joined.waitFor('message.created');
      await notJoined.expectNone('message.created');
      // но об изменении заявки узнаёт любой сокет клиента
      await notJoined.waitFor('request.updated', (p) => p.requestId === id);
    });

    it('stops delivering after request.leave', async () => {
      const id = await newRequest(tokens.broker);
      const broker = await connect(tokens.broker);
      await broker.join(id);
      expect(await broker.leave(id)).toEqual({ ok: true });

      await http('POST', `/requests/${id}/messages`, tokens.admin, {
        text: 'после выхода',
      });
      await broker.expectNone('message.created');
    });

    it('delivers a voice message together with a playable audio link', async () => {
      const id = await newRequest(tokens.broker);
      const admin = await connect(tokens.admin);
      await admin.join(id);

      const audio = wavBuffer(15);
      const ticketRes = await http(
        'POST',
        `/requests/${id}/voice-upload-url`,
        tokens.broker,
        { mime: 'audio/wav', size: audio.length },
      );
      const ticket = ticketRes.json<{
        key: string;
        uploadUrl: string;
        headers: Record<string, string>;
      }>();
      s3Keys.push(ticket.key);
      const put = await transfer(app, ticket.uploadUrl, {
        method: 'PUT',
        body: audio,
        headers: ticket.headers,
      });
      expect(put.ok).toBe(true);

      await http('POST', `/requests/${id}/messages`, tokens.broker, {
        type: 'VOICE',
        attachmentKey: ticket.key,
        durationSec: 15,
      });

      const { message } = await admin.waitFor('message.created');
      expect(message).toMatchObject({
        type: 'VOICE',
        durationSec: 15,
        text: null,
      });
      expect(message.attachments).toHaveLength(1);
      expect(message.attachments[0].kind).toBe('AUDIO');
      const playback = await transfer(app, message.attachments[0].url);
      expect(Buffer.from(await playback.arrayBuffer()).equals(audio)).toBe(
        true,
      );
    });

    it('sends nothing when posting fails', async () => {
      const id = await newRequest(tokens.broker);
      const broker = await connect(tokens.broker);
      await broker.join(id);

      expect(
        (await http('POST', `/requests/${id}/messages`, tokens.broker, {}))
          .statusCode,
      ).toBe(400);
      await prisma.request.update({
        where: { id },
        data: { status: 'APPROVED' },
      });
      expect(
        (
          await http('POST', `/requests/${id}/messages`, tokens.broker, {
            text: 'x',
          })
        ).statusCode,
      ).toBe(409);

      await broker.expectNone('message.created');
      await broker.expectNone('request.updated', (p) => p.reason === 'MESSAGE');
    });
  });

  describe('request.updated', () => {
    it('notifies managers and the owner client about a new request, not other clients', async () => {
      const admin = await connect(tokens.admin);
      const broker = await connect(tokens.broker);
      const other = await connect(tokens.otherBroker);
      const person = await connect(tokens.individual);

      const id = await newRequest(tokens.broker);

      for (const c of [admin, broker]) {
        const payload = await c.waitFor(
          'request.updated',
          (p) => p.requestId === id,
        );
        expect(payload).toMatchObject({
          requestId: id,
          clientId: fx.broker.clientId,
          status: 'NEW',
          vehicleId: null,
          reason: 'CREATED',
        });
        expect(Date.parse(payload.at)).not.toBeNaN();
      }
      await other.expectNone('request.updated', (p) => p.requestId === id);
      await person.expectNone('request.updated', (p) => p.requestId === id);
    });

    it('reports the NEW → IN_DIALOG transition on the first manager message', async () => {
      const id = await newRequest(tokens.broker);
      const broker = await connect(tokens.broker);

      // сообщение клиента: статус остаётся NEW
      await http('POST', `/requests/${id}/messages`, tokens.broker, {
        text: 'вопрос',
      });
      expect(
        await broker.waitFor(
          'request.updated',
          (p) => p.requestId === id && p.reason === 'MESSAGE',
        ),
      ).toMatchObject({ status: 'NEW' });

      await http('POST', `/requests/${id}/messages`, tokens.admin, {
        text: 'ответ',
      });
      await broker.waitFor(
        'request.updated',
        (p) =>
          p.requestId === id &&
          p.reason === 'MESSAGE' &&
          p.status === 'IN_DIALOG',
      );
    });

    it('announces approval and the created vehicle once, even if approve is repeated', async () => {
      const id = await newRequest(tokens.broker);
      const broker = await connect(tokens.broker);
      const admin = await connect(tokens.admin);
      const other = await connect(tokens.otherBroker);

      const first = await http(
        'POST',
        `/admin/requests/${id}/approve`,
        tokens.admin,
      );
      expect(first.statusCode).toBe(200);
      const vehicleId = first.json<{ vehicle: { id: string } }>().vehicle.id;

      for (const c of [broker, admin]) {
        const updated = await c.waitFor(
          'request.updated',
          (p) => p.requestId === id && p.reason === 'APPROVED',
        );
        expect(updated).toMatchObject({ status: 'APPROVED', vehicleId });

        const vehicle = await c.waitFor(
          'vehicle.status_changed',
          (p) => p.vehicleId === vehicleId,
        );
        expect(vehicle).toMatchObject({
          clientId: fx.broker.clientId,
          fromStep: null,
          toStep: 1,
          toStepTitle: 'Ожидает оплату',
          declarationNumber: null,
        });
      }

      // повторное одобрение — это не изменение, событий нет
      await http('POST', `/admin/requests/${id}/approve`, tokens.admin);
      await sleep(300);
      expect(
        broker.of('request.updated', (p) => p.reason === 'APPROVED'),
      ).toHaveLength(1);
      expect(
        broker.of('vehicle.status_changed', (p) => p.vehicleId === vehicleId),
      ).toHaveLength(1);

      await other.expectNone(
        'vehicle.status_changed',
        (p) => p.vehicleId === vehicleId,
      );
    });
  });

  describe('vehicle.status_changed', () => {
    async function newVehicle(clientId: string, startStep = 1) {
      const res = await http('POST', '/admin/vehicles', tokens.admin, {
        title: 'RT car',
        vin: randomVin(),
        clientId,
        startStep,
      });
      expect(res.statusCode).toBe(201);
      return res.json<{ id: string }>().id;
    }

    it('notifies the owner client and managers about a status change, nobody else', async () => {
      const vehicleId = await newVehicle(fx.broker.clientId);
      const admin = await connect(tokens.admin);
      const broker = await connect(tokens.broker);
      const other = await connect(tokens.otherBroker);
      const person = await connect(tokens.individual);

      const res = await http(
        'POST',
        `/admin/vehicles/${vehicleId}/status`,
        tokens.admin,
        { step: 5 },
      );
      expect(res.statusCode).toBe(200);

      for (const c of [admin, broker]) {
        expect(
          await c.waitFor(
            'vehicle.status_changed',
            (p) => p.vehicleId === vehicleId,
          ),
        ).toMatchObject({
          clientId: fx.broker.clientId,
          fromStep: 1,
          toStep: 5,
          toStepTitle: 'В пути по Китаю',
          declarationNumber: null,
        });
      }
      await other.expectNone(
        'vehicle.status_changed',
        (p) => p.vehicleId === vehicleId,
      );
      await person.expectNone(
        'vehicle.status_changed',
        (p) => p.vehicleId === vehicleId,
      );
    });

    it('includes the declaration number and covers moves backward', async () => {
      const vehicleId = await newVehicle(fx.individual.clientId, 9);
      const person = await connect(tokens.individual);

      await http('POST', `/admin/vehicles/${vehicleId}/status`, tokens.admin, {
        step: 10,
        declarationNumber: '10702070/181024/5012345',
      });
      expect(
        await person.waitFor(
          'vehicle.status_changed',
          (p) => p.vehicleId === vehicleId && p.toStep === 10,
        ),
      ).toMatchObject({
        fromStep: 9,
        declarationNumber: '10702070/181024/5012345',
      });

      await http('POST', `/admin/vehicles/${vehicleId}/status`, tokens.admin, {
        step: 8,
      });
      expect(
        await person.waitFor(
          'vehicle.status_changed',
          (p) => p.vehicleId === vehicleId && p.toStep === 8,
        ),
      ).toMatchObject({ fromStep: 10, declarationNumber: null });
    });

    it('announces a manually created vehicle to its client', async () => {
      const person = await connect(tokens.individual);
      const vehicleId = await newVehicle(fx.individual.clientId, 3);
      expect(
        await person.waitFor(
          'vehicle.status_changed',
          (p) => p.vehicleId === vehicleId,
        ),
      ).toMatchObject({
        fromStep: null,
        toStep: 3,
        clientId: fx.individual.clientId,
      });
    });

    it('sends nothing when the status change is rejected', async () => {
      const vehicleId = await newVehicle(fx.broker.clientId, 4);
      const broker = await connect(tokens.broker);
      // тот же шаг — 400; чужая роль — 403
      expect(
        (
          await http(
            'POST',
            `/admin/vehicles/${vehicleId}/status`,
            tokens.admin,
            { step: 4 },
          )
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await http(
            'POST',
            `/admin/vehicles/${vehicleId}/status`,
            tokens.broker,
            { step: 6 },
          )
        ).statusCode,
      ).toBe(403);
      await broker.expectNone(
        'vehicle.status_changed',
        (p) => p.vehicleId === vehicleId,
      );
    });
  });
});
