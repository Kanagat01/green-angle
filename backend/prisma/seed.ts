import 'dotenv/config';
import { hash } from '@node-rs/argon2';
import { PrismaPg } from '@prisma/adapter-pg';
import { ClientType, PrismaClient, Role } from '../src/generated/prisma/client.js';

const prisma = new PrismaClient({
  adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }),
});

// Только для разработки. Пароли переопределяются через SEED_*_PASSWORD.
const passwords = {
  admin: process.env.SEED_ADMIN_PASSWORD ?? 'admin12345',
  broker: process.env.SEED_BROKER_PASSWORD ?? 'broker12345',
  individual: process.env.SEED_INDIVIDUAL_PASSWORD ?? 'individual12345',
};

async function upsertUser(email: string, role: Role, password: string, clientId?: string) {
  const passwordHash = await hash(password);
  return prisma.user.upsert({
    where: { email },
    update: {},
    create: { email, role, passwordHash, clientId },
  });
}

async function findOrCreateClient(type: ClientType, name: string) {
  const existing = await prisma.client.findFirst({ where: { name } });
  return existing ?? prisma.client.create({ data: { type, name } });
}

async function createVehicle(params: {
  clientId: string;
  title: string;
  vin: string;
  currentStep: number;
  changedById: string;
  declarationNumber?: string;
}) {
  const { clientId, title, vin, currentStep, changedById, declarationNumber } = params;
  const existing = await prisma.vehicle.findUnique({ where: { vin } });
  if (existing) return existing;

  const now = new Date();
  return prisma.vehicle.create({
    data: {
      clientId,
      title,
      vin,
      currentStep,
      steps: {
        create: Array.from({ length: 13 }, (_, i) => {
          const step = i + 1;
          const completed = step < currentStep || (step === 13 && currentStep === 13);
          return {
            step,
            completedAt: completed ? now : null,
            declarationNumber: step === 10 ? declarationNumber : undefined,
          };
        }),
      },
      statusLogs: {
        create: { fromStep: null, toStep: currentStep, declarationNumber, changedById },
      },
    },
  });
}

async function main() {
  const admin = await upsertUser('admin@greenangle.local', Role.ADMIN, passwords.admin);

  const broker = await findOrCreateClient(ClientType.COMPANY, 'ООО АвтоПодбор Плюс');
  const person = await findOrCreateClient(ClientType.PERSON, 'Смирнов А. В.');

  const brokerUser = await upsertUser(
    'broker@autopodbor.local',
    Role.BROKER,
    passwords.broker,
    broker.id,
  );
  const personUser = await upsertUser(
    'smirnov@example.local',
    Role.INDIVIDUAL,
    passwords.individual,
    person.id,
  );

  await createVehicle({
    clientId: broker.id,
    title: 'Geely Monjaro, 2024',
    vin: 'LB37622Z0RX000001',
    currentStep: 9,
    changedById: admin.id,
  });
  await createVehicle({
    clientId: person.id,
    title: 'Chery Tiggo 8 Pro, 2024',
    vin: 'LVVDB11B0RD000002',
    currentStep: 2,
    changedById: admin.id,
  });
  await createVehicle({
    clientId: broker.id,
    title: 'Zeekr 001, 2024',
    vin: 'L1NSPGHB0RA000003',
    currentStep: 13,
    changedById: admin.id,
    declarationNumber: '10702070/181024/5012345',
  });

  const hasRequests = (await prisma.request.count()) > 0;
  if (!hasRequests) {
    await prisma.request.create({
      data: {
        clientId: broker.id,
        createdById: brokerUser.id,
        title: 'Haval H9, 2023',
        yearFrom: 2023,
        budget: 3200000,
        comment: 'Клиенту нужен чёрный салон, без панорамы',
      },
    });

    await prisma.request.create({
      data: {
        clientId: person.id,
        createdById: personUser.id,
        title: 'Li Auto L9',
        yearFrom: 2023,
        budget: 6500000,
        comment: 'Рассматриваю версию Max',
        status: 'IN_DIALOG',
        messages: {
          create: [
            { authorId: personUser.id, text: 'Здравствуйте! Хочу подобрать Li Auto L9.' },
            {
              authorId: admin.id,
              text: 'Добрый день! Уточните, пожалуйста, желаемый цвет и комплектацию.',
              links: ['https://example.com/listing/li-auto-l9'],
            },
          ],
        },
      },
    });
  }

  console.log('Seed complete');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
