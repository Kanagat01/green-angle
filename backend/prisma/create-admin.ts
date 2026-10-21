import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { isEmail } from 'class-validator';
import { PrismaClient, Role } from '../src/generated/prisma/client.js';

/**
 * Создаёт первого администратора в пустой (боевой) базе. Публичной регистрации нет,
 * а seed создаёт тестовых пользователей с известными паролями и в production не используется.
 *
 *   ADMIN_EMAIL=boss@company.ru ADMIN_PASSWORD='длинный-пароль' pnpm create-admin
 *
 * Дальнейших пользователей админ создаёт через API (POST /admin/users).
 */
const MIN_PASSWORD_LENGTH = 12;
const MAX_PASSWORD_LENGTH = 128;

function fail(message: string): never {
  console.error(`create-admin: ${message}`);
  process.exit(1);
}

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;

  if (!email || !isEmail(email)) fail('ADMIN_EMAIL must be a valid email');
  if (
    !password ||
    password.length < MIN_PASSWORD_LENGTH ||
    password.length > MAX_PASSWORD_LENGTH
  ) {
    fail(
      `ADMIN_PASSWORD must be ${MIN_PASSWORD_LENGTH}-${MAX_PASSWORD_LENGTH} characters long`,
    );
  }

  const prisma = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
  });
  try {
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing) fail(`user ${email} already exists`);

    await prisma.user.create({
      data: {
        email,
        passwordHash: await hash(password),
        role: Role.ADMIN,
        emailVerifiedAt: new Date(),
      },
    });
    console.log(`create-admin: administrator ${email} created`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err: unknown) => {
  console.error('create-admin: unexpected error:', err);
  process.exit(1);
});
