import { Test, TestingModule } from '@nestjs/testing';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { hash } from '@node-rs/argon2';
import { randomBytes, randomUUID } from 'node:crypto';
import { AppModule } from '../src/app.module.js';
import { configureApp } from '../src/app.setup.js';
import { ClientType, Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';

export const PASSWORD = 'test-password-123';

export async function createApp(
  extra: { controllers?: any[] } = {},
): Promise<NestFastifyApplication> {
  const moduleRef: TestingModule = await Test.createTestingModule({
    imports: [AppModule],
    controllers: extra.controllers ?? [],
  }).compile();
  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter(),
  );
  configureApp(app);
  await app.init();
  await app.getHttpAdapter().getInstance().ready();
  return app;
}

export interface Fixtures {
  admin: { id: string; email: string };
  broker: { id: string; email: string; clientId: string; vehicleId: string };
  otherBroker: {
    id: string;
    email: string;
    clientId: string;
    vehicleId: string;
  };
  individual: {
    id: string;
    email: string;
    clientId: string;
    vehicleId: string;
  };
  /** Уникальный суффикс данных этого прогона; клиенты с ним в названии удаляются в cleanup */
  tag: string;
  cleanup: () => Promise<void>;
}

/** Уникальный валидный VIN (17 символов из разрешённого алфавита). */
export function randomVin(): string {
  return `T${randomBytes(8).toString('hex').toUpperCase()}`;
}

/**
 * Изолированные тестовые данные с уникальными email (не зависят от seed):
 * админ, два подборщика-компании и физлицо, у каждого клиента по одной машине.
 */
export async function createFixtures(prisma: PrismaService): Promise<Fixtures> {
  const tag = randomUUID().slice(0, 8);
  const passwordHash = await hash(PASSWORD);

  const admin = await prisma.user.create({
    data: { email: `admin-${tag}@test.local`, passwordHash, role: Role.ADMIN },
  });

  async function client(type: ClientType, role: Role, name: string) {
    const c = await prisma.client.create({
      data: { type, name: `${name} ${tag}` },
    });
    const user = await prisma.user.create({
      data: {
        email: `${name.replace(/\s/g, '').toLowerCase()}-${tag}@test.local`,
        passwordHash,
        role,
        clientId: c.id,
      },
    });
    const vehicle = await prisma.vehicle.create({
      data: {
        clientId: c.id,
        title: `Car of ${name} ${tag}`,
        steps: {
          create: Array.from({ length: 13 }, (_, i) => ({ step: i + 1 })),
        },
      },
    });
    return {
      id: user.id,
      email: user.email,
      clientId: c.id,
      vehicleId: vehicle.id,
    };
  }

  const broker = await client(ClientType.COMPANY, Role.BROKER, 'Broker A');
  const otherBroker = await client(ClientType.COMPANY, Role.BROKER, 'Broker B');
  const individual = await client(ClientType.PERSON, Role.INDIVIDUAL, 'Person');

  const userIds = [admin.id, broker.id, otherBroker.id, individual.id];

  return {
    admin: { id: admin.id, email: admin.email },
    broker,
    otherBroker,
    individual,
    tag,
    cleanup: async () => {
      // Все клиенты прогона, включая созданные через API (в названии есть tag)
      const clients = await prisma.client.findMany({
        where: { name: { contains: tag } },
        select: { id: true },
      });
      const clientIds = clients.map((c) => c.id);
      const vehicles = await prisma.vehicle.findMany({
        where: { clientId: { in: clientIds } },
        select: { id: true },
      });
      const vehicleIds = vehicles.map((v) => v.id);

      await prisma.$transaction(async (tx) => {
        // Журнал append-only (триггер). Для очистки тестовых данных отключаем триггер
        // в рамках этой транзакции: DDL транзакционный, после коммита триггер снова активен.
        await tx.$executeRawUnsafe(
          'ALTER TABLE "VehicleStatusLog" DISABLE TRIGGER "VehicleStatusLog_append_only"',
        );
        await tx.vehicleStatusLog.deleteMany({
          where: {
            OR: [
              { vehicleId: { in: vehicleIds } },
              { changedById: { in: userIds } },
            ],
          },
        });
        await tx.$executeRawUnsafe(
          'ALTER TABLE "VehicleStatusLog" ENABLE TRIGGER "VehicleStatusLog_append_only"',
        );
        await tx.attachment.deleteMany({
          where: { uploadedById: { in: userIds } },
        });
        await tx.vehicle.deleteMany({ where: { id: { in: vehicleIds } } });
        await tx.user.deleteMany({ where: { id: { in: userIds } } });
        await tx.client.deleteMany({ where: { id: { in: clientIds } } });
      });
    },
  };
}

export async function login(
  app: NestFastifyApplication,
  email: string,
  password = PASSWORD,
) {
  return app.inject({
    method: 'POST',
    url: '/api/v1/auth/login',
    payload: { email, password },
  });
}

export async function accessTokenFor(
  app: NestFastifyApplication,
  email: string,
) {
  const res = await login(app, email);
  return res.json<{ accessToken: string }>().accessToken;
}
