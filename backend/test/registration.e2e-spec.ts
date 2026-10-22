import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createHash, randomUUID } from 'node:crypto';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  PASSWORD,
  accessTokenFor,
  createApp,
  createFixtures,
} from './helpers.js';

describe('Registration and email verification (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let mail: MailService;
  const tag = randomUUID().slice(0, 8);
  let counter = 0;
  const emailOf = () => `reg-${tag}-${++counter}@test.local`;

  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, payload });
  const body = (extra: object = {}) => ({
    type: 'COMPANY',
    name: 'ООО «АвтоПривоз Плюс»',
    inn: '7707083893',
    phone: '+7 900 123-45-67',
    email: emailOf(),
    password: PASSWORD,
    consent: true,
    ...extra,
  });
  const login = (email: string, password = PASSWORD) =>
    post('/auth/login', { email, password });
  const mailsTo = (email: string) => mail.outbox.filter((m) => m.to === email);
  const tokenFrom = (email: string) => {
    const letter = mailsTo(email).at(-1);
    expect(letter, `a letter to ${email}`).toBeDefined();
    const match = /verify-email\?token=([\w-]+)/.exec(letter!.text);
    expect(match).not.toBeNull();
    return match![1];
  };
  const userOf = (email: string) =>
    prisma.user.findUnique({ where: { email }, include: { client: true } });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { contains: `reg-${tag}-` } },
      select: { id: true, clientId: true },
    });
    await prisma.user.deleteMany({
      where: { id: { in: users.map((u) => u.id) } },
    });
    await prisma.client.deleteMany({
      where: {
        id: { in: users.flatMap((u) => (u.clientId ? [u.clientId] : [])) },
      },
    });
    await app.close();
  });

  describe('register', () => {
    it('creates a closed company account and sends the link', async () => {
      const payload = body();
      const res = await post('/auth/register', payload);
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: 'accepted' });

      const user = await userOf(payload.email);
      expect(user).toMatchObject({
        role: 'BROKER',
        isActive: true,
        emailVerifiedAt: null,
        client: {
          type: 'COMPANY',
          name: 'ООО «АвтоПривоз Плюс»',
          inn: '7707083893',
          phone: '+79001234567',
        },
      });
      expect(user!.client!.consentAt).toBeInstanceOf(Date);
      expect(user!.passwordHash).not.toContain(PASSWORD);

      const letters = mailsTo(payload.email);
      expect(letters).toHaveLength(1);
      expect(letters[0].subject).toContain('Подтвердите email');
      expect(letters[0].text).toContain(
        'http://localhost:3000/verify-email?token=',
      );
      expect(letters[0].html).toContain('verify-email?token=');
    });

    it('creates a private person account; the INN is ignored', async () => {
      const payload = body({
        type: 'PERSON',
        name: 'Смирнов Алексей',
        inn: '123',
      });
      expect((await post('/auth/register', payload)).statusCode).toBe(202);
      expect(await userOf(payload.email)).toMatchObject({
        role: 'INDIVIDUAL',
        client: { type: 'PERSON', name: 'Смирнов Алексей', inn: null },
      });
    });

    it('stores only a hash of the token, never the token itself', async () => {
      const payload = body();
      await post('/auth/register', payload);
      const token = tokenFrom(payload.email);
      const user = await userOf(payload.email);
      const rows = await prisma.emailToken.findMany({
        where: { userId: user!.id },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0].tokenHash).toBe(
        createHash('sha256').update(token).digest('hex'),
      );
      expect(rows[0].tokenHash).not.toContain(token);
      const hours =
        (rows[0].expiresAt.getTime() - Date.now()) / (60 * 60 * 1000);
      expect(hours).toBeGreaterThan(23.9);
      expect(hours).toBeLessThanOrEqual(24);
    });

    it('normalizes the email, the phone and the INN', async () => {
      const payload = body({
        email: `Reg-${tag}-MiXeD@Test.Local`,
        phone: '8 (900) 765-43-21',
        inn: '77 07 083893',
        name: '  ООО Тест  ',
      });
      expect((await post('/auth/register', payload)).statusCode).toBe(202);
      const user = await userOf(payload.email.toLowerCase());
      expect(user).toMatchObject({
        email: payload.email.toLowerCase(),
        client: { phone: '+79007654321', inn: '7707083893', name: 'ООО Тест' },
      });
    });

    it('accepts a 12-digit INN of an individual entrepreneur', async () => {
      const payload = body({ inn: '500100732259' });
      expect((await post('/auth/register', payload)).statusCode).toBe(202);
      expect((await userOf(payload.email))!.client!.inn).toBe('500100732259');
    });

    it.each([
      ['no consent', { consent: false }],
      ['consent as a string', { consent: 'true' }],
      ['company without an INN', { inn: undefined }],
      ['short INN', { inn: '123456789' }],
      ['INN of 11 digits', { inn: '12345678901' }],
      ['INN with letters', { inn: '77070abc93' }],
      ['short phone', { phone: '123' }],
      ['phone with too many digits', { phone: '1234567890123456' }],
      ['no phone', { phone: undefined }],
      ['bad email', { email: 'not-an-email' }],
      ['short password', { password: 'short' }],
      ['password over 128 characters', { password: 'p'.repeat(129) }],
      ['empty name', { name: ' ' }],
      ['unknown type', { type: 'BROKER' }],
      ['no type', { type: undefined }],
    ])('rejects %s with 400 and creates nothing', async (_name, extra) => {
      const payload = body(extra);
      const before = await prisma.client.count();
      const res = await post('/auth/register', payload);
      expect(res.statusCode).toBe(400);
      expect(await prisma.client.count()).toBe(before);
      expect(mailsTo(payload.email ?? '')).toHaveLength(0);
    });

    it('does not ask a person for an INN', async () => {
      const payload = body({ type: 'PERSON', inn: undefined });
      expect((await post('/auth/register', payload)).statusCode).toBe(202);
    });

    it('answers the same for a taken email and creates nothing more', async () => {
      const payload = body();
      const first = await post('/auth/register', payload);
      const clients = await prisma.client.count();
      const second = await post('/auth/register', {
        ...payload,
        name: 'Другая компания',
        password: 'another-password-1',
      });

      expect(second.statusCode).toBe(first.statusCode);
      expect(second.json()).toEqual(first.json());
      expect(await prisma.client.count()).toBe(clients);
      expect(mailsTo(payload.email)).toHaveLength(1);
      // пароль владельца не подменён
      expect((await userOf(payload.email))!.client!.name).toBe(payload.name);
    });

    it('creates one account when the same registration arrives twice at once', async () => {
      const payload = body();
      const [a, b] = await Promise.all([
        post('/auth/register', payload),
        post('/auth/register', payload),
      ]);
      expect([a.statusCode, b.statusCode]).toEqual([202, 202]);
      expect(await prisma.user.count({ where: { email: payload.email } })).toBe(
        1,
      );
      expect(mailsTo(payload.email).length).toBeLessThanOrEqual(1);
    });

    it('does not fail the registration when the mail cannot be sent', async () => {
      const spy = vi.spyOn(mail, 'send').mockResolvedValue(false);
      try {
        const payload = body();
        expect((await post('/auth/register', payload)).statusCode).toBe(202);
        expect(await userOf(payload.email)).not.toBeNull();
        expect(spy).toHaveBeenCalledOnce();
      } finally {
        spy.mockRestore();
      }
    });
  });

  describe('login before and after confirmation', () => {
    it('refuses a correct password with EMAIL_NOT_VERIFIED, a wrong one stays 401', async () => {
      const payload = body();
      await post('/auth/register', payload);

      const closed = await login(payload.email);
      expect(closed.statusCode).toBe(403);
      expect(closed.json()).toMatchObject({ code: 'EMAIL_NOT_VERIFIED' });
      expect(closed.json()).not.toHaveProperty('accessToken');

      const wrong = await login(payload.email, 'wrong-password-1');
      expect(wrong.statusCode).toBe(401);
      expect(wrong.json()).not.toHaveProperty('code');
    });

    it('opens after the link was followed: the account works as any other', async () => {
      const payload = body();
      await post('/auth/register', payload);
      const verified = await post('/auth/verify-email', {
        token: tokenFrom(payload.email),
      });
      expect(verified.statusCode).toBe(200);
      expect(verified.json()).toEqual({ status: 'verified' });
      expect((await userOf(payload.email))!.emailVerifiedAt).toBeInstanceOf(
        Date,
      );

      const session = await login(payload.email);
      expect(session.statusCode).toBe(200);
      const me = await app.inject({
        method: 'GET',
        url: '/api/v1/me',
        headers: {
          authorization: `Bearer ${session.json<{ accessToken: string }>().accessToken}`,
        },
      });
      expect(me.json()).toMatchObject({ role: 'BROKER', email: payload.email });
    });

    it('does not let an account that is deactivated before confirmation in', async () => {
      const payload = body();
      await post('/auth/register', payload);
      await post('/auth/verify-email', { token: tokenFrom(payload.email) });
      await prisma.user.update({
        where: { email: payload.email },
        data: { isActive: false },
      });
      expect((await login(payload.email)).statusCode).toBe(401);
    });

    it('lets in an account created by a manager without any confirmation', async () => {
      const fx = await createFixtures(prisma);
      try {
        const adminToken = await accessTokenFor(app, fx.admin.email);
        const email = emailOf();
        const created = await app.inject({
          method: 'POST',
          url: '/api/v1/admin/users',
          headers: { authorization: `Bearer ${adminToken}` },
          payload: { email, password: PASSWORD, role: 'ADMIN' },
        });
        expect(created.statusCode).toBe(201);
        expect((await userOf(email))!.emailVerifiedAt).toBeInstanceOf(Date);
        expect((await login(email)).statusCode).toBe(200);
        // письмо с подтверждением такому аккаунту не отправляется
        expect(mailsTo(email)).toHaveLength(0);
      } finally {
        await fx.cleanup();
      }
    });
  });

  describe('verify-email', () => {
    it('is safe to open the link twice', async () => {
      const payload = body();
      await post('/auth/register', payload);
      const token = tokenFrom(payload.email);
      expect((await post('/auth/verify-email', { token })).statusCode).toBe(
        200,
      );
      expect((await post('/auth/verify-email', { token })).statusCode).toBe(
        200,
      );
    });

    it('rejects an unknown or malformed token', async () => {
      for (const token of ['x'.repeat(43), 'short', '']) {
        const res = await post('/auth/verify-email', { token });
        expect(res.statusCode).toBe(400);
      }
      const unknown = await post('/auth/verify-email', {
        token: randomUUID() + randomUUID(),
      });
      expect(unknown.statusCode).toBe(400);
      expect(unknown.json()).toMatchObject({ code: 'INVALID_TOKEN' });
    });

    it('rejects an expired link and does not verify', async () => {
      const payload = body();
      await post('/auth/register', payload);
      const token = tokenFrom(payload.email);
      const user = await userOf(payload.email);
      await prisma.emailToken.updateMany({
        where: { userId: user!.id },
        data: { expiresAt: new Date(Date.now() - 1000) },
      });

      const res = await post('/auth/verify-email', { token });
      expect(res.statusCode).toBe(400);
      expect(res.json()).toMatchObject({ code: 'INVALID_TOKEN' });
      expect((await userOf(payload.email))!.emailVerifiedAt).toBeNull();
      expect((await login(payload.email)).statusCode).toBe(403);
    });

    it('confirms once when the link is opened twice at the same moment', async () => {
      const payload = body();
      await post('/auth/register', payload);
      const token = tokenFrom(payload.email);
      const results = await Promise.all([
        post('/auth/verify-email', { token }),
        post('/auth/verify-email', { token }),
        post('/auth/verify-email', { token }),
      ]);
      expect(
        results.filter((r) => r.statusCode === 200).length,
      ).toBeGreaterThanOrEqual(1);
      expect((await userOf(payload.email))!.emailVerifiedAt).toBeInstanceOf(
        Date,
      );
    });

    it('is public: needs no authorization', async () => {
      const res = await post('/auth/verify-email', { token: 'y'.repeat(43) });
      expect(res.statusCode).toBe(400); // а не 401
    });
  });

  describe('resend-verification', () => {
    it('sends a fresh link and kills the old one', async () => {
      const payload = body();
      await post('/auth/register', payload);
      const oldToken = tokenFrom(payload.email);

      const res = await post('/auth/resend-verification', {
        email: payload.email,
      });
      expect(res.statusCode).toBe(202);
      expect(res.json()).toEqual({ status: 'accepted' });
      expect(mailsTo(payload.email)).toHaveLength(2);

      const newToken = tokenFrom(payload.email);
      expect(newToken).not.toBe(oldToken);
      expect(
        (await post('/auth/verify-email', { token: oldToken })).statusCode,
      ).toBe(400);
      expect(
        (await post('/auth/verify-email', { token: newToken })).statusCode,
      ).toBe(200);
      expect((await login(payload.email)).statusCode).toBe(200);
    });

    it('says the same and sends nothing for an unknown or a confirmed address', async () => {
      const unknown = emailOf();
      const a = await post('/auth/resend-verification', { email: unknown });
      expect(a.statusCode).toBe(202);
      expect(mailsTo(unknown)).toHaveLength(0);

      const payload = body();
      await post('/auth/register', payload);
      await post('/auth/verify-email', { token: tokenFrom(payload.email) });
      const b = await post('/auth/resend-verification', {
        email: payload.email,
      });
      expect(b.statusCode).toBe(202);
      expect(b.json()).toEqual(a.json());
      expect(mailsTo(payload.email)).toHaveLength(1);
    });

    it('sends nothing to a deactivated account', async () => {
      const payload = body();
      await post('/auth/register', payload);
      await prisma.user.update({
        where: { email: payload.email },
        data: { isActive: false },
      });
      await post('/auth/resend-verification', { email: payload.email });
      expect(mailsTo(payload.email)).toHaveLength(1);
    });

    it('rejects a malformed address', async () => {
      expect(
        (await post('/auth/resend-verification', { email: 'nope' })).statusCode,
      ).toBe(400);
    });
  });
});
