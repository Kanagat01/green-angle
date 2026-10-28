import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { hash } from '@node-rs/argon2';
import { randomUUID } from 'node:crypto';
import { MailService } from '../src/mail/mail.service.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { PASSWORD, createApp } from './helpers.js';

// Выполняется до импортов: подтверждение почты выключено (так проект настроен по умолчанию)
vi.hoisted(() => {
  process.env.EMAIL_VERIFICATION_REQUIRED = 'false';
});

describe('Registration without email verification (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let mail: MailService;
  const tag = randomUUID().slice(0, 8);
  let counter = 0;
  const emailOf = () => `open-${tag}-${++counter}@test.local`;

  const post = (url: string, payload: object) =>
    app.inject({ method: 'POST', url: `/api/v1${url}`, payload });
  const body = (extra: object = {}) => ({
    type: 'PERSON',
    name: 'Смирнов Алексей Викторович',
    phone: '+7 900 123-45-67',
    email: emailOf(),
    password: PASSWORD,
    consent: true,
    ...extra,
  });

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    mail = app.get(MailService);
  });

  afterAll(async () => {
    const users = await prisma.user.findMany({
      where: { email: { contains: `open-${tag}-` } },
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

  it('opens the account at once: no letter, no token, login works right away', async () => {
    const payload = body();
    const res = await post('/auth/register', payload);
    expect(res.statusCode).toBe(202);
    expect(res.json()).toEqual({ status: 'registered' });

    const user = await prisma.user.findUniqueOrThrow({
      where: { email: payload.email },
      include: { emailTokens: true },
    });
    expect(user.emailVerifiedAt).toBeInstanceOf(Date);
    expect(user.emailTokens).toHaveLength(0);
    expect(mail.outbox.filter((m) => m.to === payload.email)).toHaveLength(0);

    const login = await post('/auth/login', {
      email: payload.email,
      password: PASSWORD,
    });
    expect(login.statusCode).toBe(200);
  });

  it('lets an account that was left unconfirmed earlier log in', async () => {
    const email = emailOf();
    await prisma.user.create({
      data: {
        email,
        passwordHash: await hash(PASSWORD),
        role: 'INDIVIDUAL',
        emailVerifiedAt: null,
      },
    });
    const login = await post('/auth/login', { email, password: PASSWORD });
    expect(login.statusCode).toBe(200);
  });

  it('keeps hiding whether the address is taken and still rejects a wrong password', async () => {
    const payload = body();
    await post('/auth/register', payload);
    const again = await post('/auth/register', {
      ...payload,
      name: 'Другой человек',
    });
    expect(again.statusCode).toBe(202);
    expect(again.json()).toEqual({ status: 'registered' });
    expect(await prisma.user.count({ where: { email: payload.email } })).toBe(
      1,
    );

    const wrong = await post('/auth/login', {
      email: payload.email,
      password: 'wrong-password-1',
    });
    expect(wrong.statusCode).toBe(401);
  });
});
