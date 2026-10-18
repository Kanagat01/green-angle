import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { io, Socket } from 'socket.io-client';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
  login,
  PASSWORD,
} from './helpers.js';

interface ClientDto {
  id: string;
  type: 'COMPANY' | 'PERSON';
  name: string;
  usersCount: number;
  vehiclesCount: number;
  requestsCount: number;
  users?: { id: string; email: string; role: string; isActive: boolean }[];
}
interface UserDto {
  id: string;
  email: string;
  role: 'ADMIN' | 'BROKER' | 'INDIVIDUAL';
  isActive: boolean;
  clientId: string | null;
  client: { id: string; name: string; type: string } | null;
}
interface Tokens {
  accessToken: string;
  refreshToken: string;
}

describe('Admin management: clients and users (e2e)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let fx: Fixtures;
  let url: string;
  const tokens = { admin: '', broker: '', individual: '' };
  const sockets: Socket[] = [];
  let seq = 0;

  const call = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    token: string | null,
    payload?: object,
  ) =>
    app.inject({
      method,
      url: `/api/v1${path}`,
      headers: token ? { authorization: `Bearer ${token}` } : {},
      payload,
    });
  const admin = (
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    payload?: object,
  ) => call(method, path, tokens.admin, payload);

  const email = (label = 'u') => `${label}-${++seq}-${fx.tag}@test.local`;
  const newClient = async (
    type: 'COMPANY' | 'PERSON' = 'COMPANY',
    label = 'Client',
  ) => {
    const res = await admin('POST', '/admin/clients', {
      type,
      name: `${label} ${++seq} ${fx.tag}`,
    });
    expect(res.statusCode).toBe(201);
    return res.json<ClientDto>();
  };
  const newUser = async (payload: object) => {
    const res = await admin('POST', '/admin/users', {
      password: PASSWORD,
      ...payload,
    });
    expect(res.statusCode).toBe(201);
    return res.json<UserDto>();
  };

  beforeAll(async () => {
    app = await createApp({ listen: true });
    url = await app.getUrl();
    prisma = app.get(PrismaService);
    fx = await createFixtures(prisma);
    tokens.admin = await accessTokenFor(app, fx.admin.email);
    tokens.broker = await accessTokenFor(app, fx.broker.email);
    tokens.individual = await accessTokenFor(app, fx.individual.email);
  });

  afterEach(() => {
    while (sockets.length) sockets.pop()!.close();
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  describe('clients', () => {
    it('creates, reads, renames and lists clients with counts', async () => {
      const company = await newClient('COMPANY', 'Авто Плюс');
      expect(company).toMatchObject({
        type: 'COMPANY',
        usersCount: 0,
        vehiclesCount: 0,
        requestsCount: 0,
        users: [],
      });

      const renamed = await admin('PATCH', `/admin/clients/${company.id}`, {
        name: `  Авто Минус ${fx.tag}  `,
      });
      expect(renamed.statusCode).toBe(200);
      expect(renamed.json<ClientDto>().name).toBe(`Авто Минус ${fx.tag}`);

      const detail = await admin('GET', `/admin/clients/${company.id}`);
      expect(detail.json<ClientDto>().name).toBe(`Авто Минус ${fx.tag}`);

      const list = await admin(
        'GET',
        `/admin/clients?search=${encodeURIComponent('авто минус')}&limit=200`,
      );
      expect(
        list.json<{ items: ClientDto[] }>().items.map((c) => c.id),
      ).toContain(company.id);
    });

    it('shows how many users, vehicles and requests a client has', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email('cnt'),
        role: 'BROKER',
        clientId: company.id,
      });
      const userToken = await accessTokenFor(app, user.email);
      await call('POST', '/requests', userToken, { title: 'Car' });
      await admin('POST', '/admin/vehicles', {
        title: 'V',
        vin: `T${(1e15 + seq).toString(16).toUpperCase().padStart(16, '0')}`.slice(
          0,
          17,
        ),
        clientId: company.id,
      });

      const detail = (
        await admin('GET', `/admin/clients/${company.id}`)
      ).json<ClientDto>();
      expect(detail).toMatchObject({
        usersCount: 1,
        requestsCount: 1,
        vehiclesCount: 1,
      });
      expect(detail.users).toEqual([
        { id: user.id, email: user.email, role: 'BROKER', isActive: true },
      ]);
    });

    it('filters the list by type', async () => {
      const person = await newClient('PERSON');
      const company = await newClient('COMPANY');
      const ids = async (query: string) =>
        (await admin('GET', `/admin/clients?limit=200&${query}`))
          .json<{ items: ClientDto[] }>()
          .items.map((c) => c.id);

      const persons = await ids('type=PERSON');
      expect(persons).toContain(person.id);
      expect(persons).not.toContain(company.id);
    });

    it('allows changing the type only while the client has no users', async () => {
      const client = await newClient('COMPANY');
      const retyped = await admin('PATCH', `/admin/clients/${client.id}`, {
        type: 'PERSON',
      });
      expect(retyped.statusCode).toBe(200);
      expect(retyped.json<ClientDto>().type).toBe('PERSON');

      await newUser({
        email: email(),
        role: 'INDIVIDUAL',
        clientId: client.id,
      });
      expect(
        (
          await admin('PATCH', `/admin/clients/${client.id}`, {
            type: 'COMPANY',
          })
        ).statusCode,
      ).toBe(409);
      // то же значение — не изменение
      expect(
        (
          await admin('PATCH', `/admin/clients/${client.id}`, {
            type: 'PERSON',
          })
        ).statusCode,
      ).toBe(200);
    });

    it('deletes an empty client', async () => {
      const client = await newClient();
      expect(
        (await admin('DELETE', `/admin/clients/${client.id}`)).statusCode,
      ).toBe(204);
      expect(
        (await admin('GET', `/admin/clients/${client.id}`)).statusCode,
      ).toBe(404);
    });

    it('refuses to delete a client with users, vehicles or requests', async () => {
      const withUser = await newClient('COMPANY');
      await newUser({ email: email(), role: 'BROKER', clientId: withUser.id });
      expect(
        (await admin('DELETE', `/admin/clients/${withUser.id}`)).statusCode,
      ).toBe(409);

      const withVehicle = await newClient('COMPANY');
      await admin('POST', '/admin/vehicles', {
        title: 'V',
        vin: `TDEL${seq}${fx.tag}`
          .toUpperCase()
          .padEnd(17, '0')
          .slice(0, 17)
          .replace(/[IOQ]/g, '1'),
        clientId: withVehicle.id,
      });
      expect(
        (await admin('DELETE', `/admin/clients/${withVehicle.id}`)).statusCode,
      ).toBe(409);

      const withRequest = await newClient('PERSON');
      const u = await newUser({
        email: email(),
        role: 'INDIVIDUAL',
        clientId: withRequest.id,
      });
      await call('POST', '/requests', await accessTokenFor(app, u.email), {
        title: 'R',
      });
      await prisma.user.update({
        where: { id: u.id },
        data: { clientId: null, role: 'ADMIN' },
      });
      expect(
        (await admin('DELETE', `/admin/clients/${withRequest.id}`)).statusCode,
      ).toBe(409);
      // клиент и его данные на месте
      expect(
        (await admin('GET', `/admin/clients/${withRequest.id}`)).statusCode,
      ).toBe(200);
    });

    it.each([
      ['empty name', { type: 'COMPANY', name: '   ' }],
      ['missing name', { type: 'COMPANY' }],
      ['bad type', { type: 'ORG', name: 'X' }],
      ['name too long', { type: 'COMPANY', name: 'x'.repeat(201) }],
    ])('rejects %s with 400', async (_name, payload) => {
      expect((await admin('POST', '/admin/clients', payload)).statusCode).toBe(
        400,
      );
    });

    it('returns 404 / 400 for unknown or malformed ids', async () => {
      const unknown = '00000000-0000-4000-8000-000000000000';
      expect((await admin('GET', `/admin/clients/${unknown}`)).statusCode).toBe(
        404,
      );
      expect(
        (await admin('PATCH', `/admin/clients/${unknown}`, { name: 'X' }))
          .statusCode,
      ).toBe(404);
      expect(
        (await admin('DELETE', `/admin/clients/${unknown}`)).statusCode,
      ).toBe(404);
      expect((await admin('GET', '/admin/clients/not-a-uuid')).statusCode).toBe(
        400,
      );
    });

    it('is closed to non-admins and anonymous callers', async () => {
      for (const token of [tokens.broker, tokens.individual]) {
        expect((await call('GET', '/admin/clients', token)).statusCode).toBe(
          403,
        );
        expect(
          (
            await call('POST', '/admin/clients', token, {
              type: 'COMPANY',
              name: 'X',
            })
          ).statusCode,
        ).toBe(403);
      }
      expect((await call('GET', '/admin/clients', null)).statusCode).toBe(401);
    });
  });

  describe('users: creation', () => {
    it('creates a broker login that works immediately and never leaks the hash', async () => {
      const company = await newClient('COMPANY');
      const address = email('Broker');
      const res = await admin('POST', '/admin/users', {
        email: `  ${address.toUpperCase()}  `,
        password: 'initial-pass-1',
        role: 'BROKER',
        clientId: company.id,
      });
      expect(res.statusCode).toBe(201);
      const user = res.json<UserDto>();
      expect(user).toMatchObject({
        email: address.toLowerCase(),
        role: 'BROKER',
        isActive: true,
        clientId: company.id,
        client: { id: company.id, type: 'COMPANY' },
      });
      expect(JSON.stringify(user)).not.toMatch(/passwordHash|argon2/);

      const session = await login(app, address, 'initial-pass-1');
      expect(session.statusCode).toBe(200);
      const me = await call('GET', '/me', session.json<Tokens>().accessToken);
      expect(me.json()).toMatchObject({
        role: 'BROKER',
        client: { id: company.id },
      });
    });

    it('creates an individual and an admin', async () => {
      const person = await newClient('PERSON');
      const individual = await newUser({
        email: email(),
        role: 'INDIVIDUAL',
        clientId: person.id,
      });
      expect(individual).toMatchObject({
        role: 'INDIVIDUAL',
        clientId: person.id,
      });

      const colleague = await newUser({ email: email('adm'), role: 'ADMIN' });
      expect(colleague).toMatchObject({
        role: 'ADMIN',
        clientId: null,
        client: null,
      });
      const adminToken = await accessTokenFor(app, colleague.email);
      expect((await call('GET', '/admin/clients', adminToken)).statusCode).toBe(
        200,
      );
    });

    it('rejects a duplicate email regardless of case', async () => {
      const company = await newClient('COMPANY');
      const address = email('dup');
      await newUser({ email: address, role: 'BROKER', clientId: company.id });
      const again = await admin('POST', '/admin/users', {
        email: address.toUpperCase(),
        password: PASSWORD,
        role: 'BROKER',
        clientId: company.id,
      });
      expect(again.statusCode).toBe(409);
    });

    it('keeps the role consistent with the client type', async () => {
      const company = await newClient('COMPANY');
      const person = await newClient('PERSON');
      const create = (payload: object) =>
        admin('POST', '/admin/users', {
          email: email(),
          password: PASSWORD,
          ...payload,
        });

      expect(
        (await create({ role: 'BROKER', clientId: person.id })).statusCode,
      ).toBe(400);
      expect(
        (await create({ role: 'INDIVIDUAL', clientId: company.id })).statusCode,
      ).toBe(400);
      expect((await create({ role: 'BROKER' })).statusCode).toBe(400);
      expect((await create({ role: 'INDIVIDUAL' })).statusCode).toBe(400);
      expect(
        (await create({ role: 'ADMIN', clientId: company.id })).statusCode,
      ).toBe(400);
      expect(
        (
          await create({
            role: 'BROKER',
            clientId: '00000000-0000-4000-8000-000000000000',
          })
        ).statusCode,
      ).toBe(404);
    });

    it.each([
      ['short password', { password: 'short' }],
      ['huge password', { password: 'x'.repeat(129) }],
      ['bad email', { email: 'not-an-email' }],
      ['unknown role', { role: 'OWNER' }],
      ['missing password', { password: undefined }],
    ])('rejects %s with 400', async (_name, override) => {
      const company = await newClient('COMPANY');
      const res = await admin('POST', '/admin/users', {
        email: email(),
        password: PASSWORD,
        role: 'BROKER',
        clientId: company.id,
        ...override,
      });
      expect(res.statusCode).toBe(400);
    });

    it('is closed to non-admins and anonymous callers', async () => {
      const body = { email: email(), password: PASSWORD, role: 'ADMIN' };
      expect(
        (await call('POST', '/admin/users', tokens.broker, body)).statusCode,
      ).toBe(403);
      expect(
        (await call('POST', '/admin/users', tokens.individual, body))
          .statusCode,
      ).toBe(403);
      expect((await call('POST', '/admin/users', null, body)).statusCode).toBe(
        401,
      );
      expect(
        (await call('GET', '/admin/users', tokens.broker)).statusCode,
      ).toBe(403);
    });
  });

  describe('users: reading', () => {
    it('lists users with filters and without password hashes', async () => {
      const company = await newClient('COMPANY');
      const a = await newUser({
        email: email('find-me'),
        role: 'BROKER',
        clientId: company.id,
      });
      const b = await newUser({
        email: email('other'),
        role: 'BROKER',
        clientId: company.id,
      });
      await admin('PATCH', `/admin/users/${b.id}`, { isActive: false });

      const list = (query: string) =>
        admin('GET', `/admin/users?limit=200&${query}`);
      const idsOf = async (query: string) =>
        (await list(query)).json<{ items: UserDto[] }>().items.map((u) => u.id);

      expect(await idsOf(`clientId=${company.id}`)).toEqual(
        expect.arrayContaining([a.id, b.id]),
      );
      expect(await idsOf(`clientId=${company.id}&isActive=true`)).toEqual([
        a.id,
      ]);
      expect(await idsOf(`clientId=${company.id}&isActive=false`)).toEqual([
        b.id,
      ]);
      expect(await idsOf('role=ADMIN')).not.toContain(a.id);
      expect(await idsOf(`search=FIND-ME&clientId=${company.id}`)).toEqual([
        a.id,
      ]);
      expect((await list(`clientId=${company.id}`)).body).not.toMatch(
        /passwordHash/,
      );
    });

    it('paginates and validates query parameters', async () => {
      const first = (await admin('GET', '/admin/users?limit=1')).json<{
        items: UserDto[];
        total: number;
      }>();
      expect(first.items).toHaveLength(1);
      expect(first.total).toBeGreaterThan(1);
      expect((await admin('GET', '/admin/users?role=OWNER')).statusCode).toBe(
        400,
      );
      expect(
        (await admin('GET', '/admin/users?isActive=maybe')).statusCode,
      ).toBe(400);
      expect(
        (await admin('GET', '/admin/users?clientId=nope')).statusCode,
      ).toBe(400);
    });

    it('returns a single user, 404 for unknown and 400 for malformed ids', async () => {
      const res = await admin('GET', `/admin/users/${fx.broker.id}`);
      expect(res.json<UserDto>()).toMatchObject({
        id: fx.broker.id,
        role: 'BROKER',
      });
      expect(
        (
          await admin(
            'GET',
            '/admin/users/00000000-0000-4000-8000-000000000000',
          )
        ).statusCode,
      ).toBe(404);
      expect((await admin('GET', '/admin/users/not-a-uuid')).statusCode).toBe(
        400,
      );
    });
  });

  describe('users: update and deactivation', () => {
    it('changes the email; login follows the new address', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email('old'),
        role: 'BROKER',
        clientId: company.id,
      });
      const next = email('NEW');

      const res = await admin('PATCH', `/admin/users/${user.id}`, {
        email: next.toUpperCase(),
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<UserDto>().email).toBe(next.toLowerCase());
      expect((await login(app, user.email)).statusCode).toBe(401);
      expect((await login(app, next)).statusCode).toBe(200);
    });

    it('rejects an email that is taken, an empty body and an unknown user', async () => {
      const company = await newClient('COMPANY');
      const a = await newUser({
        email: email(),
        role: 'BROKER',
        clientId: company.id,
      });
      const b = await newUser({
        email: email(),
        role: 'BROKER',
        clientId: company.id,
      });
      expect(
        (await admin('PATCH', `/admin/users/${a.id}`, { email: b.email }))
          .statusCode,
      ).toBe(409);
      expect(
        (await admin('PATCH', `/admin/users/${a.id}`, {})).statusCode,
      ).toBe(400);
      expect(
        (
          await admin(
            'PATCH',
            '/admin/users/00000000-0000-4000-8000-000000000000',
            { isActive: false },
          )
        ).statusCode,
      ).toBe(404);
    });

    it('does not let a user change the role through PATCH', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email(),
        role: 'BROKER',
        clientId: company.id,
      });
      const res = await admin('PATCH', `/admin/users/${user.id}`, {
        role: 'ADMIN',
        isActive: true,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<UserDto>().role).toBe('BROKER');
    });

    it('deactivation blocks login, kills the access token, refresh tokens and sockets at once', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email('leaver'),
        role: 'BROKER',
        clientId: company.id,
      });
      const session = (await login(app, user.email)).json<Tokens>();
      expect((await call('GET', '/me', session.accessToken)).statusCode).toBe(
        200,
      );

      const socket = io(url, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: session.accessToken },
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      const closed = new Promise<string>((resolve) =>
        socket.once('disconnect', resolve),
      );

      const res = await admin('PATCH', `/admin/users/${user.id}`, {
        isActive: false,
      });
      expect(res.statusCode).toBe(200);
      expect(res.json<UserDto>().isActive).toBe(false);

      // уже выданный access-токен перестаёт работать немедленно
      expect((await call('GET', '/me', session.accessToken)).statusCode).toBe(
        401,
      );
      expect(
        (await call('GET', '/vehicles', session.accessToken)).statusCode,
      ).toBe(401);
      // вход и обновление токена закрыты
      expect((await login(app, user.email)).statusCode).toBe(401);
      const refresh = await call('POST', '/auth/refresh', null, {
        refreshToken: session.refreshToken,
      });
      expect(refresh.statusCode).toBe(401);
      // сокет закрыт сервером, переподключиться с тем же токеном нельзя
      expect(await closed).toBe('io server disconnect');
      const retry = io(url, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: session.accessToken },
      });
      sockets.push(retry);
      const error = await new Promise<Error>((resolve) =>
        retry.once('connect_error', resolve),
      );
      expect(error.message).toBe('unauthorized');
    });

    it('reactivation restores access', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email(),
        role: 'BROKER',
        clientId: company.id,
      });
      await admin('PATCH', `/admin/users/${user.id}`, { isActive: false });
      expect((await login(app, user.email)).statusCode).toBe(401);

      await admin('PATCH', `/admin/users/${user.id}`, { isActive: true });
      expect((await login(app, user.email)).statusCode).toBe(200);
    });

    it('does not let an admin deactivate themselves', async () => {
      const res = await admin('PATCH', `/admin/users/${fx.admin.id}`, {
        isActive: false,
      });
      expect(res.statusCode).toBe(409);
      expect((await call('GET', '/me', tokens.admin)).statusCode).toBe(200);
    });

    it('a deactivated admin loses admin access immediately', async () => {
      const colleague = await newUser({ email: email('adm'), role: 'ADMIN' });
      const colleagueToken = await accessTokenFor(app, colleague.email);
      expect(
        (await call('GET', '/admin/users', colleagueToken)).statusCode,
      ).toBe(200);

      await admin('PATCH', `/admin/users/${colleague.id}`, { isActive: false });
      expect(
        (await call('GET', '/admin/users', colleagueToken)).statusCode,
      ).toBe(401);
    });
  });

  describe('users: password reset', () => {
    it('sets an explicit password, invalidates the old one and ends sessions', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email(),
        role: 'BROKER',
        clientId: company.id,
        password: 'old-password-1',
      });
      const session = (
        await login(app, user.email, 'old-password-1')
      ).json<Tokens>();

      const res = await admin(
        'POST',
        `/admin/users/${user.id}/reset-password`,
        { password: 'brand-new-pass-2' },
      );
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ temporaryPassword: null });

      expect((await login(app, user.email, 'old-password-1')).statusCode).toBe(
        401,
      );
      expect(
        (await login(app, user.email, 'brand-new-pass-2')).statusCode,
      ).toBe(200);
      expect(
        (
          await call('POST', '/auth/refresh', null, {
            refreshToken: session.refreshToken,
          })
        ).statusCode,
      ).toBe(401);
    });

    it('generates a temporary password when none is given', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email(),
        role: 'BROKER',
        clientId: company.id,
      });

      const res = await admin(
        'POST',
        `/admin/users/${user.id}/reset-password`,
        {},
      );
      expect(res.statusCode).toBe(200);
      const { temporaryPassword } = res.json<{ temporaryPassword: string }>();
      expect(temporaryPassword).toHaveLength(16);
      expect((await login(app, user.email, PASSWORD)).statusCode).toBe(401);
      expect((await login(app, user.email, temporaryPassword)).statusCode).toBe(
        200,
      );

      // каждый сброс даёт новый пароль
      const second = (
        await admin('POST', `/admin/users/${user.id}/reset-password`, {})
      ).json<{ temporaryPassword: string }>();
      expect(second.temporaryPassword).not.toBe(temporaryPassword);
    });

    it('validates the password and the target', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email(),
        role: 'BROKER',
        clientId: company.id,
      });
      expect(
        (
          await admin('POST', `/admin/users/${user.id}/reset-password`, {
            password: 'short',
          })
        ).statusCode,
      ).toBe(400);
      expect(
        (
          await admin(
            'POST',
            '/admin/users/00000000-0000-4000-8000-000000000000/reset-password',
            {},
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (
          await call(
            'POST',
            `/admin/users/${user.id}/reset-password`,
            tokens.broker,
            {},
          )
        ).statusCode,
      ).toBe(403);
    });

    it('kills the open sockets of the user', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email(),
        role: 'BROKER',
        clientId: company.id,
      });
      const { accessToken } = (await login(app, user.email)).json<Tokens>();
      const socket = io(url, {
        transports: ['websocket'],
        reconnection: false,
        auth: { token: accessToken },
      });
      sockets.push(socket);
      await new Promise<void>((resolve, reject) => {
        socket.once('connect', () => resolve());
        socket.once('connect_error', reject);
      });
      const closed = new Promise<string>((resolve) =>
        socket.once('disconnect', resolve),
      );

      await admin('POST', `/admin/users/${user.id}/reset-password`, {});
      expect(await closed).toBe('io server disconnect');
    });
  });

  describe('users: deletion', () => {
    it('deletes a user without history; the login stops working', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email(),
        role: 'BROKER',
        clientId: company.id,
      });
      const { accessToken } = (await login(app, user.email)).json<Tokens>();

      expect(
        (await admin('DELETE', `/admin/users/${user.id}`)).statusCode,
      ).toBe(204);
      expect((await admin('GET', `/admin/users/${user.id}`)).statusCode).toBe(
        404,
      );
      expect((await login(app, user.email)).statusCode).toBe(401);
      expect((await call('GET', '/me', accessToken)).statusCode).toBe(401);
    });

    it('refuses to delete a user with history and suggests deactivation', async () => {
      const company = await newClient('COMPANY');
      const user = await newUser({
        email: email(),
        role: 'BROKER',
        clientId: company.id,
      });
      await call('POST', '/requests', await accessTokenFor(app, user.email), {
        title: 'History',
      });

      const res = await admin('DELETE', `/admin/users/${user.id}`);
      expect(res.statusCode).toBe(409);
      expect(res.json<{ message: string }>().message).toContain('deactivate');
      expect((await admin('GET', `/admin/users/${user.id}`)).statusCode).toBe(
        200,
      );
    });

    it('refuses to delete yourself and handles unknown users', async () => {
      expect(
        (await admin('DELETE', `/admin/users/${fx.admin.id}`)).statusCode,
      ).toBe(409);
      expect(
        (
          await admin(
            'DELETE',
            '/admin/users/00000000-0000-4000-8000-000000000000',
          )
        ).statusCode,
      ).toBe(404);
      expect(
        (await call('DELETE', `/admin/users/${fx.broker.id}`, tokens.broker))
          .statusCode,
      ).toBe(403);
    });
  });

  describe('end to end', () => {
    it('onboards a new broker company: client → login → first request visible to managers', async () => {
      const company = await newClient('COMPANY', 'Новый партнёр');
      const user = await newUser({
        email: email('partner'),
        role: 'BROKER',
        clientId: company.id,
      });
      const token = await accessTokenFor(app, user.email);

      const created = await call('POST', '/requests', token, {
        title: 'Haval H9',
      });
      expect(created.statusCode).toBe(201);

      const queue = await admin(
        'GET',
        `/admin/requests?clientId=${company.id}`,
      );
      const items = queue.json<{
        items: { title: string; client: { name: string } }[];
      }>().items;
      expect(items).toHaveLength(1);
      expect(items[0]).toMatchObject({
        title: 'Haval H9',
        client: { name: company.name },
      });

      // изоляция: другой подборщик ничего не видит
      const otherList = await call('GET', '/requests', tokens.broker);
      expect(
        otherList
          .json<{ items: { title: string }[] }>()
          .items.map((r) => r.title),
      ).not.toContain('Haval H9');
    });
  });
});
