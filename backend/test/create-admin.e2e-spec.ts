import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { createApp, login } from './helpers.js';

/** Запускает настоящий скрипт `pnpm create-admin` отдельным процессом. */
function runCreateAdmin(env: Record<string, string>) {
  const res = spawnSync('pnpm', ['create-admin'], {
    env: { ...process.env, ...env },
    encoding: 'utf8',
    shell: true, // pnpm на Windows — .cmd
    timeout: 60_000,
  });
  return { code: res.status, out: `${res.stdout}\n${res.stderr}` };
}

describe('create-admin script (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  const tag = randomUUID().slice(0, 8);
  const email = `first-admin-${tag}@test.local`;
  const password = 'correct-horse-battery-1';

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await prisma.user.deleteMany({ where: { email: { contains: tag } } });
    await app.close();
  });

  it('creates an administrator who can log in and use the admin API', async () => {
    const run = runCreateAdmin({
      ADMIN_EMAIL: `  ${email.toUpperCase()}  `,
      ADMIN_PASSWORD: password,
    });
    expect(run.code).toBe(0);
    expect(run.out).toContain(`administrator ${email} created`);
    expect(run.out).not.toContain(password);

    const user = await prisma.user.findUniqueOrThrow({ where: { email } });
    expect(user).toMatchObject({
      role: 'ADMIN',
      clientId: null,
      isActive: true,
    });
    expect(user.passwordHash).not.toContain(password);

    const session = await login(app, email, password);
    expect(session.statusCode).toBe(200);
    const { accessToken } = session.json<{ accessToken: string }>();
    const list = await app.inject({
      method: 'GET',
      url: '/api/v1/admin/users?limit=1',
      headers: { authorization: `Bearer ${accessToken}` },
    });
    expect(list.statusCode).toBe(200);
  });

  it('refuses to overwrite an existing user', () => {
    const run = runCreateAdmin({
      ADMIN_EMAIL: email,
      ADMIN_PASSWORD: 'another-password-123',
    });
    expect(run.code).toBe(1);
    expect(run.out).toContain('already exists');
  });

  it.each([
    ['missing email', { ADMIN_PASSWORD: password }, 'ADMIN_EMAIL'],
    [
      'invalid email',
      { ADMIN_EMAIL: 'not-an-email', ADMIN_PASSWORD: password },
      'ADMIN_EMAIL',
    ],
    [
      'missing password',
      { ADMIN_EMAIL: `x-${tag}@test.local` },
      'ADMIN_PASSWORD',
    ],
    [
      'short password',
      { ADMIN_EMAIL: `x-${tag}@test.local`, ADMIN_PASSWORD: 'short-pass' },
      'ADMIN_PASSWORD',
    ],
  ])(
    'rejects %s without touching the database',
    async (_name, env, mentions) => {
      const before = await prisma.user.count();
      const run = runCreateAdmin({
        ADMIN_EMAIL: '',
        ADMIN_PASSWORD: '',
        ...env,
      });
      expect(run.code).toBe(1);
      expect(run.out).toContain(mentions);
      expect(await prisma.user.count()).toBe(before);
    },
  );
});
