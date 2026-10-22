import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  stepEvidence,
} from './helpers.js';

interface Card {
  id: string;
  notifyEmail: string | null;
  notifyEnabled: boolean;
}

describe('Email notifications about status changes (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let mail: MailService;
  let fx: Fixtures;
  const tokens = { admin: '', broker: '', otherBroker: '', individual: '' };

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
  const mailsTo = (email: string) => mail.outbox.filter((m) => m.to === email);
  const move = async (vehicleId: string, step: number, extra: object = {}) => {
    const res = await call(
      'POST',
      `/admin/vehicles/${vehicleId}/status`,
      tokens.admin,
      {
        step,
        ...(await stepEvidence(app, fx.admin.id, step)),
        ...extra,
      },
    );
    expect(res.statusCode).toBe(200);
  };
  const newVehicle = async (clientId: string, startStep = 1) => {
    const res = await call('POST', '/admin/vehicles', tokens.admin, {
      title: `Notify ${fx.tag}`,
      clientId,
      startStep,
      vin: `LVN${fx.tag.replace(/\D/g, '').padEnd(6, '1')}${Math.floor(Math.random() * 1e8)}`
        .slice(0, 17)
        .padEnd(17, '0'),
    });
    expect(res.statusCode).toBe(201);
    return res.json<Card>().id;
  };
  const settings = (
    vehicleId: string,
    payload: object,
    token = tokens.broker,
  ) => call('PATCH', `/vehicles/${vehicleId}/notifications`, token, payload);

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
    fx = await createFixtures(prisma);
    for (const [key, email] of [
      ['admin', fx.admin.email],
      ['broker', fx.broker.email],
      ['otherBroker', fx.otherBroker.email],
      ['individual', fx.individual.email],
    ] as const) {
      tokens[key] = await accessTokenFor(app, email);
    }
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  describe('a private person', () => {
    it('gets a letter with the new stage on the way forward', async () => {
      const id = await newVehicle(fx.individual.clientId);
      await move(id, 2);

      const letters = mailsTo(fx.individual.email);
      expect(letters).toHaveLength(1);
      expect(letters[0].subject).toBe(`Notify ${fx.tag}: Получена оплата`);
      expect(letters[0].text).toContain(
        'Новый этап (2 из 13): «Получена оплата»',
      );
      expect(letters[0].text).toContain(`http://localhost:3000/cars/${id}`);
      expect(letters[0].html).toContain(`/cars/${id}`);
    });

    it('gets one letter per move and none for a step back, a repeat or a number only', async () => {
      const id = await newVehicle(fx.individual.clientId, 9);
      const before = mailsTo(fx.individual.email).length;

      await move(id, 10, { declarationNumber: 'D-1' }); // вперёд
      expect(mailsTo(fx.individual.email)).toHaveLength(before + 1);

      await move(id, 10, { declarationNumber: 'D-2' }); // тот же этап, только номер
      await move(id, 8); // назад: исправление ошибки
      expect(mailsTo(fx.individual.email)).toHaveLength(before + 1);

      await move(id, 9); // снова вперёд
      expect(mailsTo(fx.individual.email)).toHaveLength(before + 2);
    });

    it('is switched on by default and can be switched off and on in the profile', async () => {
      const me = await call('GET', '/me', tokens.individual);
      expect(
        me.json<{ emailNotifications: boolean }>().emailNotifications,
      ).toBe(true);

      const off = await call('PATCH', '/me', tokens.individual, {
        emailNotifications: false,
      });
      expect(off.statusCode).toBe(200);
      expect(
        off.json<{ emailNotifications: boolean }>().emailNotifications,
      ).toBe(false);

      const id = await newVehicle(fx.individual.clientId);
      const before = mailsTo(fx.individual.email).length;
      await move(id, 2);
      expect(mailsTo(fx.individual.email)).toHaveLength(before);

      await call('PATCH', '/me', tokens.individual, {
        emailNotifications: true,
      });
      await move(id, 3);
      expect(mailsTo(fx.individual.email)).toHaveLength(before + 1);
    });

    it('is not mailed after the account is deactivated', async () => {
      const id = await newVehicle(fx.individual.clientId);
      await prisma.user.update({
        where: { id: fx.individual.id },
        data: { isActive: false },
      });
      try {
        const before = mailsTo(fx.individual.email).length;
        await move(id, 2);
        expect(mailsTo(fx.individual.email)).toHaveLength(before);
      } finally {
        await prisma.user.update({
          where: { id: fx.individual.id },
          data: { isActive: true },
        });
      }
    });

    it('rejects a non-boolean setting and an empty profile update is harmless', async () => {
      expect(
        (
          await call('PATCH', '/me', tokens.individual, {
            emailNotifications: 'no',
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (await call('PATCH', '/me', tokens.individual, {})).statusCode,
      ).toBe(200);
    });
  });

  describe('a broker and their end client', () => {
    it('sends nothing until the broker turns notifications on', async () => {
      const id = await newVehicle(fx.broker.clientId);
      const before = mail.outbox.length;
      await move(id, 2);
      expect(mail.outbox).toHaveLength(before);
    });

    it('mails the end client, not the broker, once enabled — without a link to the cabinet', async () => {
      const id = await newVehicle(fx.broker.clientId);
      const endClient = `end-${fx.tag}@client.test`;
      const set = await settings(id, { email: endClient, enabled: true });
      expect(set.statusCode).toBe(200);
      expect(set.json<Card>()).toMatchObject({
        notifyEmail: endClient,
        notifyEnabled: true,
      });

      const brokerBefore = mailsTo(fx.broker.email).length;
      await move(id, 2);
      const letters = mailsTo(endClient);
      expect(letters).toHaveLength(1);
      expect(letters[0].text).toContain(
        'Новый этап (2 из 13): «Получена оплата»',
      );
      expect(letters[0].text).not.toContain('/cars/');
      expect(mailsTo(fx.broker.email)).toHaveLength(brokerBefore);
    });

    it('stops when switched off and keeps the address for later', async () => {
      const id = await newVehicle(fx.broker.clientId);
      const endClient = `off-${fx.tag}@client.test`;
      await settings(id, { email: endClient, enabled: true });
      const off = await settings(id, { enabled: false });
      expect(off.json<Card>()).toMatchObject({
        notifyEmail: endClient,
        notifyEnabled: false,
      });

      await move(id, 2);
      expect(mailsTo(endClient)).toHaveLength(0);

      await settings(id, { enabled: true });
      await move(id, 3);
      expect(mailsTo(endClient)).toHaveLength(1);
    });

    it('changing the address does not switch notifications on or off by itself', async () => {
      const id = await newVehicle(fx.broker.clientId);
      const first = await settings(id, {
        email: `first-${fx.tag}@client.test`,
      });
      expect(first.json<Card>()).toMatchObject({ notifyEnabled: false });
      await move(id, 2);
      expect(mailsTo(`first-${fx.tag}@client.test`)).toHaveLength(0);
    });

    it('lets in the new address when it is replaced', async () => {
      const id = await newVehicle(fx.broker.clientId);
      await settings(id, { email: `old-${fx.tag}@client.test`, enabled: true });
      await settings(id, { email: `NEW-${fx.tag}@Client.Test` });
      await move(id, 2);
      expect(mailsTo(`old-${fx.tag}@client.test`)).toHaveLength(0);
      expect(mailsTo(`new-${fx.tag}@client.test`)).toHaveLength(1);
    });

    it('cannot be enabled without an address', async () => {
      const id = await newVehicle(fx.broker.clientId);
      expect((await settings(id, { enabled: true })).statusCode).toBe(400);
      expect((await settings(id, {})).statusCode).toBe(400);
      expect((await settings(id, { email: 'not an email' })).statusCode).toBe(
        400,
      );
      expect((await settings(id, { enabled: 'yes' })).statusCode).toBe(400);
      const card = (
        await call('GET', `/vehicles/${id}`, tokens.broker)
      ).json<Card>();
      expect(card).toMatchObject({ notifyEmail: null, notifyEnabled: false });
    });

    it('is shown to the owner and the manager in the card and in the lists', async () => {
      const id = await newVehicle(fx.broker.clientId);
      const endClient = `shown-${fx.tag}@client.test`;
      await settings(id, { email: endClient, enabled: true });

      const asBroker = (
        await call('GET', `/vehicles/${id}`, tokens.broker)
      ).json<Card>();
      const asAdmin = (
        await call('GET', `/vehicles/${id}`, tokens.admin)
      ).json<Card>();
      for (const card of [asBroker, asAdmin]) {
        expect(card).toMatchObject({
          notifyEmail: endClient,
          notifyEnabled: true,
        });
      }
      const list = (
        await call(
          'GET',
          `/vehicles?search=${encodeURIComponent(fx.tag)}&limit=100`,
          tokens.broker,
        )
      ).json<{ items: Card[] }>();
      expect(list.items.find((v) => v.id === id)).toMatchObject({
        notifyEmail: endClient,
        notifyEnabled: true,
      });
    });
  });

  describe('access to the settings', () => {
    it("hides another broker's vehicle and forbids everyone else", async () => {
      const id = await newVehicle(fx.broker.clientId);
      expect(
        (await settings(id, { enabled: false }, tokens.otherBroker)).statusCode,
      ).toBe(404);
      expect(
        (await settings(id, { enabled: false }, tokens.individual)).statusCode,
      ).toBe(403);
      expect(
        (await settings(id, { enabled: false }, tokens.admin)).statusCode,
      ).toBe(403);
      expect(
        (
          await settings('00000000-0000-4000-8000-000000000000', {
            enabled: false,
          })
        ).statusCode,
      ).toBe(404);
      expect((await settings('nope', { enabled: false })).statusCode).toBe(400);
    });

    it('requires authentication', async () => {
      const id = await newVehicle(fx.broker.clientId);
      const res = await app.inject({
        method: 'PATCH',
        url: `/api/v1/vehicles/${id}/notifications`,
        payload: { enabled: false },
      });
      expect(res.statusCode).toBe(401);
    });
  });

  describe('failures', () => {
    it('never break the status change when the mail cannot be sent', async () => {
      const id = await newVehicle(fx.individual.clientId);
      const spy = vi.spyOn(mail, 'send').mockResolvedValue(false);
      try {
        await move(id, 2);
        expect(spy).toHaveBeenCalledOnce();
      } finally {
        spy.mockRestore();
      }
      const card = (await call('GET', `/vehicles/${id}`, tokens.admin)).json<{
        currentStep: number;
      }>();
      expect(card.currentStep).toBe(2);
    });

    it('never break the status change when sending throws an exception', async () => {
      const id = await newVehicle(fx.individual.clientId);
      const spy = vi.spyOn(mail, 'send').mockRejectedValue(new Error('boom'));
      try {
        await move(id, 2);
      } finally {
        spy.mockRestore();
      }
    });
  });
});
