import { Controller, Get } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthUser } from '../src/auth/auth-user.js';
import { CurrentUser } from '../src/auth/decorators/current-user.decorator.js';
import { Roles } from '../src/auth/decorators/roles.decorator.js';
import { clientScope } from '../src/common/scope.js';
import { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
} from './helpers.js';

/**
 * Тестовый контроллер: на нём проверяются RolesGuard и scope-хелпер через настоящий HTTP,
 * пока реальные сущностные эндпоинты (этап 5+) не появились.
 */
@Controller('_test')
class RbacProbeController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('admin-only')
  @Roles(Role.ADMIN)
  adminOnly() {
    return { ok: true };
  }

  @Get('clients-only')
  @Roles(Role.BROKER, Role.INDIVIDUAL)
  clientsOnly() {
    return { ok: true };
  }

  @Get('vehicles')
  vehicles(@CurrentUser() user: AuthUser) {
    return this.prisma.vehicle.findMany({
      where: clientScope(user),
      select: { id: true, clientId: true },
    });
  }
}

describe('RBAC and data isolation (e2e)', () => {
  let app: NestFastifyApplication;
  let fx: Fixtures;
  const tokens: Record<
    'admin' | 'broker' | 'otherBroker' | 'individual',
    string
  > = {
    admin: '',
    broker: '',
    otherBroker: '',
    individual: '',
  };

  const get = (url: string, token?: string) =>
    app.inject({
      method: 'GET',
      url: `/api/v1${url}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
    });

  beforeAll(async () => {
    app = await createApp({ controllers: [RbacProbeController] });
    fx = await createFixtures(app.get(PrismaService));
    tokens.admin = await accessTokenFor(app, fx.admin.email);
    tokens.broker = await accessTokenFor(app, fx.broker.email);
    tokens.otherBroker = await accessTokenFor(app, fx.otherBroker.email);
    tokens.individual = await accessTokenFor(app, fx.individual.email);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  describe('role guard', () => {
    it('lets ADMIN into admin-only routes', async () => {
      expect((await get('/_test/admin-only', tokens.admin)).statusCode).toBe(
        200,
      );
    });

    it.each(['broker', 'individual'] as const)(
      'forbids %s on admin-only routes',
      async (who) => {
        expect((await get('/_test/admin-only', tokens[who])).statusCode).toBe(
          403,
        );
      },
    );

    it('forbids ADMIN on client-only routes', async () => {
      expect((await get('/_test/clients-only', tokens.admin)).statusCode).toBe(
        403,
      );
    });

    it('returns 401 without a token before the role check', async () => {
      expect((await get('/_test/admin-only')).statusCode).toBe(401);
    });
  });

  describe('client scope', () => {
    const idsOf = async (token: string) =>
      (await get('/_test/vehicles', token))
        .json<{ id: string }[]>()
        .map((v) => v.id);

    it('broker sees only its own vehicles', async () => {
      const ids = await idsOf(tokens.broker);
      expect(ids).toContain(fx.broker.vehicleId);
      expect(ids).not.toContain(fx.otherBroker.vehicleId);
      expect(ids).not.toContain(fx.individual.vehicleId);
    });

    it('another broker does not see the first broker vehicles', async () => {
      const ids = await idsOf(tokens.otherBroker);
      expect(ids).toContain(fx.otherBroker.vehicleId);
      expect(ids).not.toContain(fx.broker.vehicleId);
    });

    it('individual does not see broker vehicles', async () => {
      const ids = await idsOf(tokens.individual);
      expect(ids).toEqual([fx.individual.vehicleId]);
    });

    it('admin sees vehicles of all clients', async () => {
      const ids = await idsOf(tokens.admin);
      expect(ids).toEqual(
        expect.arrayContaining([
          fx.broker.vehicleId,
          fx.otherBroker.vehicleId,
          fx.individual.vehicleId,
        ]),
      );
    });
  });
});
