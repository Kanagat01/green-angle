import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  randomVin,
} from './helpers.js';

interface Message {
  id: string;
  type: 'TEXT' | 'VOICE' | 'SYSTEM';
  text: string | null;
  author: { id: string; role: string } | null;
  isMine: boolean;
  attachments: unknown[];
  links: string[];
}

describe('System messages in the dialog (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '', otherBroker: '' };

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

  async function newRequest() {
    const res = await call('POST', '/requests', tokens.broker, {
      title: `System ${fx.tag}`,
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }
  const messages = async (id: string, token = tokens.broker) =>
    (await call('GET', `/requests/${id}/messages`, token)).json<{
      items: Message[];
    }>().items;
  const system = async (id: string) =>
    (await messages(id)).filter((m) => m.type === 'SYSTEM');
  const approve = (id: string) =>
    call('POST', `/admin/requests/${id}/approve`, tokens.admin);
  const changeStatus = (vehicleId: string, step: number, extra: object = {}) =>
    call('POST', `/admin/vehicles/${vehicleId}/status`, tokens.admin, {
      step,
      ...extra,
    });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    fx = await createFixtures(prisma);
    tokens.admin = await accessTokenFor(app, fx.admin.email);
    tokens.broker = await accessTokenFor(app, fx.broker.email);
    tokens.otherBroker = await accessTokenFor(app, fx.otherBroker.email);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  describe('approval and rejection', () => {
    it('writes a system line when a request is approved', async () => {
      const id = await newRequest();
      await approve(id);

      const [line, ...rest] = await system(id);
      expect(rest).toHaveLength(0);
      expect(line).toEqual(
        expect.objectContaining({
          type: 'SYSTEM',
          text: 'Менеджер одобрил вариант и создал заказ. Статус: «Ожидает оплату».',
          author: null,
          isMine: false,
          attachments: [],
          links: [],
        }),
      );
    });

    it('writes it once even if approval is repeated or raced', async () => {
      const id = await newRequest();
      await Promise.all([approve(id), approve(id), approve(id)]);
      await approve(id);
      expect(await system(id)).toHaveLength(1);
    });

    it('writes a system line when a request is rejected, once', async () => {
      const id = await newRequest();
      const reject = () =>
        call('POST', `/admin/requests/${id}/reject`, tokens.admin);
      await reject();
      await reject();

      const lines = await system(id);
      expect(lines).toHaveLength(1);
      expect(lines[0]).toMatchObject({
        text: 'Менеджер отклонил заявку.',
        author: null,
      });
    });

    it('writes nothing when the action is refused', async () => {
      const id = await newRequest();
      await approve(id);
      const refused = await call(
        'POST',
        `/admin/requests/${id}/reject`,
        tokens.admin,
      );
      expect(refused.statusCode).toBe(409);
      expect(await system(id)).toHaveLength(1);
    });
  });

  describe('vehicle status changes', () => {
    async function approvedVehicle() {
      const id = await newRequest();
      const res = await approve(id);
      return {
        requestId: id,
        vehicleId: res.json<{ vehicle: { id: string } }>().vehicle.id,
      };
    }

    it('writes the new status into the dialog of the linked request', async () => {
      const { requestId, vehicleId } = await approvedVehicle();
      expect((await changeStatus(vehicleId, 3)).statusCode).toBe(200);
      expect((await changeStatus(vehicleId, 4)).statusCode).toBe(200);

      const texts = (await system(requestId)).map((m) => m.text);
      expect(texts).toEqual([
        'Менеджер одобрил вариант и создал заказ. Статус: «Ожидает оплату».',
        'Статус машины: «Выкуплен, ожидает погрузки у продавца».',
        'Статус машины: «В транспортной компании в Китае».',
      ]);
    });

    it('also writes a move back', async () => {
      const { requestId, vehicleId } = await approvedVehicle();
      await changeStatus(vehicleId, 5);
      await changeStatus(vehicleId, 2);
      const texts = (await system(requestId)).map((m) => m.text);
      expect(texts.at(-1)).toBe('Статус машины: «Получена оплата».');
      expect(texts).toHaveLength(3);
    });

    it('does not write a line when only the declaration number is added', async () => {
      const { requestId, vehicleId } = await approvedVehicle();
      await changeStatus(vehicleId, 10, { declarationNumber: 'A-1' });
      const before = await system(requestId);
      const again = await changeStatus(vehicleId, 10, {
        declarationNumber: 'A-2',
      });
      expect(again.statusCode).toBe(200);
      expect(await system(requestId)).toHaveLength(before.length);
    });

    it('does not write a line for a rejected status change', async () => {
      const { requestId, vehicleId } = await approvedVehicle();
      const refused = await changeStatus(vehicleId, 99);
      expect(refused.statusCode).toBe(400);
      expect(await system(requestId)).toHaveLength(1);
    });

    it('changes the status of a vehicle without a request and writes nothing anywhere', async () => {
      const before = await prisma.message.count({
        where: { request: { clientId: fx.broker.clientId } },
      });
      const created = await call('POST', '/admin/vehicles', tokens.admin, {
        title: 'No request',
        vin: randomVin(),
        clientId: fx.broker.clientId,
      });
      expect(created.statusCode).toBe(201);
      const res = await changeStatus(created.json<{ id: string }>().id, 2);
      expect(res.statusCode).toBe(200);
      expect(
        await prisma.message.count({
          where: { request: { clientId: fx.broker.clientId } },
        }),
      ).toBe(before);
    });

    it('is visible to the owner and managers only', async () => {
      const { requestId, vehicleId } = await approvedVehicle();
      await changeStatus(vehicleId, 2);

      expect(
        (await messages(requestId, tokens.admin)).filter(
          (m) => m.type === 'SYSTEM',
        ),
      ).toHaveLength(2);
      const other = await call(
        'GET',
        `/requests/${requestId}/messages`,
        tokens.otherBroker,
      );
      expect(other.statusCode).toBe(404);
    });
  });

  describe('unread counters', () => {
    const unread = async (id: string, token: string) =>
      (await call('GET', `/requests/${id}`, token)).json<{
        unreadCount: number;
      }>().unreadCount;
    const total = async (token: string) =>
      (await call('GET', '/requests/unread-count', token)).json<{
        unreadCount: number;
      }>().unreadCount;

    it('counts only human messages: system lines never become unread', async () => {
      const id = await newRequest();
      await call('POST', `/requests/${id}/messages`, tokens.broker, {
        text: 'Нужен Haval',
      });
      await call('POST', `/requests/${id}/messages`, tokens.admin, {
        text: 'Есть варианты',
      });
      expect(await unread(id, tokens.broker)).toBe(1);
      expect(await unread(id, tokens.admin)).toBe(1);

      const approved = await approve(id);
      await changeStatus(
        approved.json<{ vehicle: { id: string } }>().vehicle.id,
        3,
      );
      expect(await system(id)).toHaveLength(2);

      expect(await unread(id, tokens.broker)).toBe(1);
      expect(await unread(id, tokens.admin)).toBe(1);
    });

    it('lets a request with only system lines be fully read', async () => {
      const id = await newRequest();
      await approve(id);
      expect(await unread(id, tokens.broker)).toBe(0);
      expect(await unread(id, tokens.admin)).toBe(0);
      const before = await total(tokens.broker);
      await call('POST', `/requests/${id}/read`, tokens.broker);
      expect(await total(tokens.broker)).toBe(before);
    });
  });

  describe('integrity', () => {
    it('does not let a user create a SYSTEM message through the API', async () => {
      const id = await newRequest();
      const res = await call('POST', `/requests/${id}/messages`, tokens.admin, {
        type: 'SYSTEM',
        text: 'Подделка',
      });
      expect(res.statusCode).toBe(400);
      expect(await system(id)).toHaveLength(0);
    });

    it('is enforced by the database: an author exists exactly for non-system messages', async () => {
      const id = await newRequest();
      await expect(
        prisma.message.create({
          data: { requestId: id, type: 'TEXT', text: 'без автора' },
        }),
      ).rejects.toThrow();
      await expect(
        prisma.message.create({
          data: {
            requestId: id,
            type: 'SYSTEM',
            text: 'с автором',
            authorId: fx.admin.id,
          },
        }),
      ).rejects.toThrow();
    });
  });
});
