import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  randomVin,
  stepEvidence,
  transfer,
} from './helpers.js';

interface Attachment {
  id: string;
  kind: string;
  url: string;
}
interface Card {
  id: string;
  currentStep: number;
  steps: {
    step: number;
    state: string;
    declarationNumber: string | null;
    attachments: Attachment[];
  }[];
}
interface Message {
  id: string;
  type: 'TEXT' | 'VOICE' | 'SYSTEM';
  text: string | null;
  author: { id: string; role: string } | null;
  attachments: Attachment[];
}

describe('Status change with evidence and comment (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '' };

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

  async function newVehicle(startStep: number) {
    const res = await call('POST', '/admin/vehicles', tokens.admin, {
      title: `Evidence ${fx.tag}`,
      vin: randomVin(),
      clientId: fx.broker.clientId,
      startStep,
    });
    expect(res.statusCode).toBe(201);
    return res.json<Card>().id;
  }
  const status = (id: string, payload: object) =>
    call('POST', `/admin/vehicles/${id}/status`, tokens.admin, payload);
  const card = async (id: string) =>
    (await call('GET', `/vehicles/${id}`, tokens.admin)).json<Card>();
  const evidence = (step: number) => stepEvidence(app, fx.admin.id, step);
  const upload = async (
    kind: 'PHOTO' | 'VIDEO' | 'FILE',
    mime: string,
    userId = fx.admin.id,
  ) => {
    const bytes = new Uint8Array(16).fill(5);
    const t = await app
      .get(StorageService)
      .createUploadTicket(userId, kind, mime, bytes.length);
    const put = await transfer(app, t.uploadUrl, {
      method: 'PUT',
      body: bytes,
      headers: t.headers,
    });
    expect(put.ok).toBe(true);
    return { key: t.key, kind };
  };
  const stateOf = async (id: string) => ({
    step: (await card(id)).currentStep,
    logs: await prisma.vehicleStatusLog.count({ where: { vehicleId: id } }),
    attachments: await prisma.attachment.count({
      where: { vehicleStep: { vehicleId: id } },
    }),
  });

  /** Одобренная заявка с машиной: диалог по заявке существует. */
  async function vehicleWithRequest() {
    const created = await call('POST', '/requests', tokens.broker, {
      title: `Dialog ${fx.tag}`,
    });
    const requestId = created.json<{ id: string }>().id;
    const approved = await call(
      'POST',
      `/admin/requests/${requestId}/approve`,
      tokens.admin,
    );
    return {
      requestId,
      vehicleId: approved.json<{ vehicle: { id: string } }>().vehicle.id,
    };
  }
  const dialog = async (requestId: string) =>
    (await call('GET', `/requests/${requestId}/messages`, tokens.admin)).json<{
      items: Message[];
    }>().items;

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    fx = await createFixtures(prisma);
    tokens.admin = await accessTokenFor(app, fx.admin.email);
    tokens.broker = await accessTokenFor(app, fx.broker.email);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  describe('required attachment', () => {
    it('refuses a step that expects a file when none is attached', async () => {
      const id = await newVehicle(1);
      const before = await stateOf(id);
      const res = await status(id, { step: 2 });
      expect(res.statusCode).toBe(400);
      expect(res.json<{ message: string }>().message).toContain('FILE');
      expect(await stateOf(id)).toEqual(before);
    });

    it('saves the status together with the attachment and shows it on the step', async () => {
      const id = await newVehicle(1);
      const res = await status(id, { step: 2, ...(await evidence(2)) });
      expect(res.statusCode).toBe(200);

      const step = (await card(id)).steps[1];
      expect(step.state).toBe('CURRENT');
      expect(step.attachments).toHaveLength(1);
      expect(step.attachments[0].kind).toBe('FILE');
      const file = await transfer(app, step.attachments[0].url);
      expect(new Uint8Array(await file.arrayBuffer())).toEqual(
        new Uint8Array(32).fill(1),
      );
    });

    it.each([
      [3, 'PHOTO', 'image/png'],
      [4, 'VIDEO', 'video/mp4'],
      [8, 'FILE', 'application/pdf'],
    ] as const)(
      'step %i takes %s and refuses to go without it',
      async (step, kind, mime) => {
        const id = await newVehicle(step - 1);
        expect((await status(id, { step })).statusCode).toBe(400);
        const ok = await status(id, {
          step,
          attachments: [await upload(kind, mime)],
        });
        expect(ok.statusCode).toBe(200);
      },
    );

    it('refuses an attachment of another kind than the step expects', async () => {
      const id = await newVehicle(2); // шаг 3 ждёт фото
      const before = await stateOf(id);
      const res = await status(id, {
        step: 3,
        attachments: [await upload('VIDEO', 'video/mp4')],
      });
      expect(res.statusCode).toBe(400);
      expect(await stateOf(id)).toEqual(before);
    });

    it('refuses attachments for a step that takes none', async () => {
      const id = await newVehicle(4); // шаг 5 вложений не ждёт
      const res = await status(id, {
        step: 5,
        attachments: [await upload('PHOTO', 'image/png')],
      });
      expect(res.statusCode).toBe(400);
      expect((await status(id, { step: 5 })).statusCode).toBe(200);
    });

    it('accepts several attachments of the expected kind', async () => {
      const id = await newVehicle(2);
      const res = await status(id, {
        step: 3,
        attachments: [
          await upload('PHOTO', 'image/png'),
          await upload('PHOTO', 'image/jpeg'),
        ],
      });
      expect(res.statusCode).toBe(200);
      expect((await card(id)).steps[2].attachments).toHaveLength(2);
    });

    it('counts an attachment added to the step earlier', async () => {
      const id = await newVehicle(2);
      const earlier = await call(
        'POST',
        `/admin/vehicles/${id}/steps/3/attachments`,
        tokens.admin,
        await upload('PHOTO', 'image/png'),
      );
      expect(earlier.statusCode).toBe(201);
      expect((await status(id, { step: 3 })).statusCode).toBe(200);
    });

    it('does not ask again for evidence the step already has when coming back', async () => {
      const id = await newVehicle(1);
      await status(id, { step: 2, ...(await evidence(2)) });
      await status(id, { step: 3, ...(await evidence(3)) });
      expect((await status(id, { step: 1 })).statusCode).toBe(200);
      // шаг 3 уже подтверждён фото — повторно загружать не нужно
      expect((await status(id, { step: 3 })).statusCode).toBe(200);
    });

    it('lets a correction move back without any attachment', async () => {
      const id = await newVehicle(7);
      const res = await status(id, { step: 3 });
      expect(res.statusCode).toBe(200);
      expect((await card(id)).currentStep).toBe(3);
    });

    it('asks for the declaration number on step 10, once', async () => {
      const id = await newVehicle(9);
      expect((await status(id, { step: 10 })).statusCode).toBe(400);

      const ok = await status(id, { step: 10, declarationNumber: 'D-1' });
      expect(ok.statusCode).toBe(200);
      expect((await card(id)).steps[9].declarationNumber).toBe('D-1');

      // номер уже сохранён: возвращаясь на шаг 10, вводить его заново не нужно
      await status(id, { step: 9 });
      expect((await status(id, { step: 10 })).statusCode).toBe(200);
    });

    it('does not ask for evidence on steps without one', async () => {
      const id = await newVehicle(10);
      expect((await status(id, { step: 11 })).statusCode).toBe(200);
    });
  });

  describe('atomicity', () => {
    it('changes nothing when an attachment key was never uploaded', async () => {
      const { requestId, vehicleId } = await vehicleWithRequest();
      const before = await stateOf(vehicleId);
      const messagesBefore = (await dialog(requestId)).length;

      const res = await status(vehicleId, {
        step: 2,
        comment: 'Оплата получена',
        attachments: [
          {
            key: `file/${fx.admin.id}/00000000-0000-4000-8000-000000000000.pdf`,
            kind: 'FILE',
          },
        ],
      });
      expect(res.statusCode).toBe(400);
      expect(await stateOf(vehicleId)).toEqual(before);
      expect(await dialog(requestId)).toHaveLength(messagesBefore);
    });

    it("refuses another user's key and a key registered before", async () => {
      const id = await newVehicle(1);
      const foreign = await upload('FILE', 'application/pdf', fx.broker.id);
      const res = await status(id, { step: 2, attachments: [foreign] });
      expect(res.statusCode).toBe(400);

      const mine = await upload('FILE', 'application/pdf');
      expect(
        (await status(id, { step: 2, attachments: [mine] })).statusCode,
      ).toBe(200);
      const other = await newVehicle(1);
      expect(
        (await status(other, { step: 2, attachments: [mine] })).statusCode,
      ).toBe(409);
    });

    it('validates the payload', async () => {
      const id = await newVehicle(1);
      for (const payload of [
        { step: 2, comment: 'x'.repeat(2001) },
        { step: 2, attachments: 'nope' },
        { step: 2, attachments: [{ key: '', kind: 'FILE' }] },
        { step: 2, attachments: [{ key: 'k', kind: 'ZIP' }] },
        {
          step: 3,
          attachments: Array.from({ length: 11 }, () => ({
            key: 'k',
            kind: 'PHOTO',
          })),
        },
      ]) {
        expect((await status(id, payload)).statusCode).toBe(400);
      }
      expect((await card(id)).currentStep).toBe(1);
    });
  });

  describe('same step', () => {
    it('is refused without anything to add', async () => {
      const id = await newVehicle(4);
      expect((await status(id, { step: 4 })).statusCode).toBe(400);
    });

    it('lets the manager add an attachment or a comment to the current step', async () => {
      const id = await newVehicle(4);
      const withFile = await status(id, {
        step: 4,
        attachments: [await upload('VIDEO', 'video/mp4')],
      });
      expect(withFile.statusCode).toBe(200);
      expect((await card(id)).steps[3].attachments).toHaveLength(1);

      const withComment = await status(id, {
        step: 4,
        comment: 'Погрузка завершена',
      });
      expect(withComment.statusCode).toBe(200);
    });
  });

  describe('comment for the client', () => {
    it('goes into the dialog after the system line, with the step attachments', async () => {
      const { requestId, vehicleId } = await vehicleWithRequest();
      const bytesBefore = (await dialog(requestId)).length;

      const res = await status(vehicleId, {
        step: 2,
        comment: '  Платёж получен, спасибо  ',
        ...(await evidence(2)),
      });
      expect(res.statusCode).toBe(200);

      const items = await dialog(requestId);
      expect(items).toHaveLength(bytesBefore + 2);
      const [system, comment] = items.slice(-2);
      expect(system).toMatchObject({
        type: 'SYSTEM',
        text: 'Статус машины: «Получена оплата».',
        author: null,
      });
      expect(comment).toMatchObject({
        type: 'TEXT',
        text: 'Платёж получен, спасибо',
        author: { id: fx.admin.id, role: 'ADMIN' },
      });
      expect(comment.attachments).toHaveLength(1);
      expect(comment.attachments[0].kind).toBe('FILE');

      // клиент видит то же самое и может скачать файл
      const asClient = (
        await call('GET', `/requests/${requestId}/messages`, tokens.broker)
      ).json<{ items: Message[] }>().items;
      const file = await transfer(app, asClient.at(-1)!.attachments[0].url);
      expect(file.ok).toBe(true);

      // одно и то же вложение видно и на шаге машины
      const step = (await card(vehicleId)).steps[1];
      expect(step.attachments.map((a) => a.id)).toEqual(
        comment.attachments.map((a) => a.id),
      );
    });

    it('counts as an unread message of the manager for the client', async () => {
      const { requestId, vehicleId } = await vehicleWithRequest();
      await status(vehicleId, {
        step: 2,
        comment: 'Привет',
        ...(await evidence(2)),
      });
      const view = await call('GET', `/requests/${requestId}`, tokens.broker);
      expect(view.json<{ unreadCount: number }>().unreadCount).toBe(1);
    });

    it('is ignored when the comment is blank or the vehicle has no request', async () => {
      const { requestId, vehicleId } = await vehicleWithRequest();
      const before = (await dialog(requestId)).length;
      await status(vehicleId, {
        step: 2,
        comment: '   ',
        ...(await evidence(2)),
      });
      expect(await dialog(requestId)).toHaveLength(before + 1); // только строка этапа

      const lone = await newVehicle(1);
      const res = await status(lone, {
        step: 2,
        comment: 'Некому читать',
        ...(await evidence(2)),
      });
      expect(res.statusCode).toBe(200);
      expect(
        await prisma.message.count({ where: { text: 'Некому читать' } }),
      ).toBe(0);
    });

    it('keeps the step attachments when the request is deleted by hand', async () => {
      const { requestId, vehicleId } = await vehicleWithRequest();
      await status(vehicleId, {
        step: 2,
        comment: 'Файл во вложении',
        ...(await evidence(2)),
      });
      expect((await card(vehicleId)).steps[1].attachments).toHaveLength(1);

      await prisma.request.delete({ where: { id: requestId } });

      expect(await prisma.message.count({ where: { requestId } })).toBe(0);
      expect((await card(vehicleId)).steps[1].attachments).toHaveLength(1);
    });
  });

  describe('access', () => {
    it('forbids non-managers', async () => {
      const id = await newVehicle(1);
      const res = await call(
        'POST',
        `/admin/vehicles/${id}/status`,
        tokens.broker,
        {
          step: 2,
        },
      );
      expect(res.statusCode).toBe(403);
    });
  });
});
