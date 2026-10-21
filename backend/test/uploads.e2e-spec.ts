import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { PrismaService } from '../src/prisma/prisma.service.js';
import {
  accessTokenFor,
  createApp,
  createFixtures,
  Fixtures,
} from './helpers.js';

interface Presigned {
  key: string;
  uploadUrl: string;
  method: string;
  headers: Record<string, string>;
  expiresIn: number;
}

describe('POST /uploads/presign (e2e)', () => {
  let app: NestFastifyApplication;
  let fx: Fixtures;
  let token: string;

  const presign = (payload: object, authToken: string | null = token) =>
    app.inject({
      method: 'POST',
      url: '/api/v1/uploads/presign',
      headers: authToken ? { authorization: `Bearer ${authToken}` } : {},
      payload,
    });

  beforeAll(async () => {
    app = await createApp();
    fx = await createFixtures(app.get(PrismaService));
    token = await accessTokenFor(app, fx.broker.email);
  });

  afterAll(async () => {
    await fx.cleanup();
    await app.close();
  });

  it('requires authentication', async () => {
    const res = await presign(
      { kind: 'PHOTO', mime: 'image/png', size: 100 },
      null,
    );
    expect(res.statusCode).toBe(401);
  });

  it('issues a presigned PUT scoped to the user and kind', async () => {
    const res = await presign({
      kind: 'AUDIO',
      mime: 'audio/webm;codecs=opus',
      size: 50_000,
    });
    expect(res.statusCode).toBe(200);
    const body = res.json<Presigned>();

    expect(body.method).toBe('PUT');
    expect(body.key).toMatch(
      new RegExp(`^audio/${fx.broker.id}/[0-9a-f-]{36}\\.webm$`),
    );
    expect(body.headers).toEqual({ 'Content-Type': 'audio/webm' });
    expect(body.expiresIn).toBe(900);

    // ссылка подписана: у S3 — параметры X-Amz-*, у диска — key/exp/type/size/sig
    const url = new URL(body.uploadUrl, 'http://localhost');
    if (process.env.STORAGE_DRIVER === 's3') {
      expect(url.pathname).toContain(body.key);
      expect(url.searchParams.get('X-Amz-Signature')).toBeTruthy();
      expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
      expect(url.searchParams.get('X-Amz-SignedHeaders')).toContain(
        'content-type',
      );
    } else {
      expect(url.pathname).toBe('/api/v1/files/upload');
      expect(url.searchParams.get('key')).toBe(body.key);
      expect(url.searchParams.get('type')).toBe('audio/webm');
      expect(url.searchParams.get('size')).toBe('50000');
      expect(url.searchParams.get('sig')).toBeTruthy();
    }
  });

  it('issues unique keys per call', async () => {
    const payload = { kind: 'PHOTO', mime: 'image/jpeg', size: 1000 };
    const a = (await presign(payload)).json<Presigned>();
    const b = (await presign(payload)).json<Presigned>();
    expect(a.key).not.toBe(b.key);
  });

  it('rejects a disallowed mime type with 415', async () => {
    const res = await presign({ kind: 'FILE', mime: 'text/html', size: 100 });
    expect(res.statusCode).toBe(415);
  });

  it('rejects a mime of another kind with 415', async () => {
    const res = await presign({ kind: 'PHOTO', mime: 'audio/webm', size: 100 });
    expect(res.statusCode).toBe(415);
  });

  it('rejects oversized audio (> 10 MB) with 413', async () => {
    const res = await presign({
      kind: 'AUDIO',
      mime: 'audio/webm',
      size: 10 * 1024 * 1024 + 1,
    });
    expect(res.statusCode).toBe(413);
  });

  it.each([
    { kind: 'NOPE', mime: 'image/png', size: 10 },
    { kind: 'PHOTO', mime: 'image/png', size: 0 },
    { kind: 'PHOTO', mime: 'image/png', size: 'big' },
    { kind: 'PHOTO', size: 10 },
  ])('validates the payload %j with 400', async (payload) => {
    const res = await presign(payload);
    expect(res.statusCode).toBe(400);
  });
});
