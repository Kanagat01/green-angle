import { BadRequestException } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createFastifyAdapter } from '../src/app.setup.js';
import { DiskStorageService } from '../src/storage/disk-storage.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { createApp, transfer } from './helpers.js';

/** Маршруты загрузки и скачивания драйвера disk (с S3 их нет: ссылки ведут прямо в S3). */
describe.runIf(process.env.STORAGE_DRIVER === 'disk')(
  'Disk storage links (e2e)',
  () => {
    let app: NestFastifyApplication;
    let storage: StorageService;
    const userId = 'user_disk-test';
    const keys: string[] = [];

    const bytes = new Uint8Array(Array.from({ length: 100 }, (_, i) => i));

    beforeAll(async () => {
      app = await createApp();
      storage = app.get(StorageService);
    });

    afterAll(async () => {
      vi.useRealTimers();
      await Promise.all(keys.map((k) => storage.delete(k)));
      await app.close();
    });

    async function ticket(
      mime = 'image/png',
      size = bytes.length,
      kind: 'PHOTO' | 'FILE' = 'PHOTO',
    ) {
      const t = await storage.createUploadTicket(userId, kind, mime, size);
      keys.push(t.key);
      return t;
    }

    async function uploaded(mime = 'image/png') {
      const t = await ticket(mime);
      const res = await transfer(app, t.uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: t.headers,
      });
      expect(res.status).toBe(204);
      return t;
    }

    it('is the configured driver and its directory is writable', async () => {
      expect(storage).toBeInstanceOf(DiskStorageService);
      await expect(storage.ping()).resolves.toBeUndefined();
    });

    it('stores an upload and serves it back without a JWT', async () => {
      const t = await uploaded();
      expect(await storage.head(t.key)).toEqual({
        size: bytes.length,
        contentType: 'image/png',
      });

      const res = await transfer(app, await storage.presignDownload(t.key));
      expect(res.status).toBe(200);
      expect(new Uint8Array(await res.arrayBuffer())).toEqual(bytes);
      expect(res.headers.get('content-type')).toBe('image/png');
      expect(res.headers.get('content-length')).toBe(String(bytes.length));
      expect(res.headers.get('content-disposition')).toBe('inline');
      expect(res.headers.get('accept-ranges')).toBe('bytes');
      expect(res.headers.get('cross-origin-resource-policy')).toBe(
        'cross-origin',
      );
    });

    it('serves documents of non-viewable types as attachments', async () => {
      const t = await ticket('application/zip', bytes.length, 'FILE');
      await transfer(app, t.uploadUrl, {
        method: 'PUT',
        body: bytes,
        headers: t.headers,
      });
      const res = await transfer(app, await storage.presignDownload(t.key));
      expect(res.headers.get('content-disposition')).toBe('attachment');
    });

    describe('Range requests (audio/video seeking)', () => {
      let url: string;
      beforeAll(async () => {
        url = await storage.presignDownload((await uploaded()).key);
      });

      it.each([
        ['bytes=10-19', 206, 10, 19],
        ['bytes=90-', 206, 90, 99],
        ['bytes=-5', 206, 95, 99],
        ['bytes=0-1000', 206, 0, 99],
      ])('%s → %i', async (range, status, start, end) => {
        const res = await transfer(app, url, { headers: { Range: range } });
        expect(res.status).toBe(status);
        expect(res.headers.get('content-range')).toBe(
          `bytes ${start}-${end}/100`,
        );
        expect(new Uint8Array(await res.arrayBuffer())).toEqual(
          bytes.slice(start, end + 1),
        );
      });

      it.each([
        'bytes=100-',
        'bytes=50-10',
        'bytes=-0',
        'items=1-2',
        'bytes=-',
      ])('rejects %s with 416', async (range) => {
        const res = await transfer(app, url, { headers: { Range: range } });
        expect(res.status).toBe(416);
        expect(res.headers.get('content-range')).toBe('bytes */100');
      });
    });

    describe('upload protection', () => {
      it('refuses a body of another size than signed', async () => {
        const t = await ticket();
        const res = await transfer(app, t.uploadUrl, {
          method: 'PUT',
          body: new Uint8Array(bytes.length + 1),
          headers: t.headers,
        });
        expect(res.status).toBe(403);
        expect(await storage.head(t.key)).toBeNull();
      });

      it('refuses another Content-Type than signed', async () => {
        const t = await ticket();
        const res = await transfer(app, t.uploadUrl, {
          method: 'PUT',
          body: bytes,
          headers: { 'Content-Type': 'text/html' },
        });
        expect(res.status).toBe(403);
        expect(await storage.head(t.key)).toBeNull();
      });

      it('refuses a link with a changed key, type, size or signature', async () => {
        const t = await ticket();
        const url = new URL(t.uploadUrl, 'http://localhost');
        const other = await ticket();
        const variants: Record<string, string> = {
          key: new URL(other.uploadUrl, 'http://localhost').searchParams.get(
            'key',
          )!,
          type: 'image/jpeg',
          size: '5000',
          sig: 'AAAA',
        };
        for (const [param, value] of Object.entries(variants)) {
          const changed = new URL(url);
          changed.searchParams.set(param, value);
          const res = await transfer(app, changed.pathname + changed.search, {
            method: 'PUT',
            body: bytes,
            headers: t.headers,
          });
          expect(res.status, param).toBe(403);
        }
        expect(await storage.head(t.key)).toBeNull();
      });

      it('allows an upload link to be used only once', async () => {
        const t = await uploaded();
        const again = await transfer(app, t.uploadUrl, {
          method: 'PUT',
          body: bytes,
          headers: t.headers,
        });
        expect(again.status).toBe(409);
        expect(await storage.head(t.key)).toMatchObject({ size: 100 });
      });

      it('does not accept a download link as an upload link', async () => {
        const t = await ticket();
        const download = await storage.presignDownload(t.key);
        const asUpload = download
          .replace('/files/download', '/files/upload')
          .concat(`&type=image%2Fpng&size=${bytes.length}`);
        const res = await transfer(app, asUpload, {
          method: 'PUT',
          body: bytes,
          headers: t.headers,
        });
        expect(res.status).toBe(403);
        expect(await storage.head(t.key)).toBeNull();
      });

      it('does not accept an upload link as a download link', async () => {
        const done = await uploaded();
        const upload = (
          await storage.createUploadTicket(userId, 'PHOTO', 'image/png', 100)
        ).uploadUrl;
        const asDownload = upload.replace('/files/upload', '/files/download');
        expect((await transfer(app, asDownload)).status).toBe(403);
        expect(await storage.head(done.key)).not.toBeNull();
      });
    });

    describe('link expiry', () => {
      afterEach(() => vi.useRealTimers());

      it('expires upload and download links', async () => {
        const t = await ticket();
        const done = await uploaded();
        const download = await storage.presignDownload(done.key);

        vi.useFakeTimers({ toFake: ['Date'] });
        vi.setSystemTime(Date.now() + 2 * 60 * 60 * 1000);

        const put = await transfer(app, t.uploadUrl, {
          method: 'PUT',
          body: bytes,
          headers: t.headers,
        });
        expect(put.status).toBe(403);
        expect((await transfer(app, download)).status).toBe(403);
      });
    });

    describe('production adapter (body limit 1 MB for JSON)', () => {
      let prodApp: NestFastifyApplication;
      let prodStorage: StorageService;

      beforeAll(async () => {
        prodApp = await createApp({
          adapter: createFastifyAdapter({
            LOG_LEVEL: 'fatal',
            TRUST_PROXY: false,
          }),
        });
        prodStorage = prodApp.get(StorageService);
      });

      afterAll(async () => {
        await prodApp.close();
      });

      it('accepts a file larger than the JSON body limit', async () => {
        const big = new Uint8Array(3 * 1024 * 1024).fill(7);
        const t = await prodStorage.createUploadTicket(
          userId,
          'PHOTO',
          'image/png',
          big.length,
        );
        keys.push(t.key);
        const put = await transfer(prodApp, t.uploadUrl, {
          method: 'PUT',
          body: big,
          headers: t.headers,
        });
        expect(put.status).toBe(204);
        expect(await prodStorage.head(t.key)).toMatchObject({
          size: big.length,
        });
      });

      it('still rejects an oversized JSON body', async () => {
        const res = await prodApp.inject({
          method: 'POST',
          url: '/api/v1/auth/login',
          headers: { 'content-type': 'application/json' },
          payload: JSON.stringify({ email: 'a@b.c', pad: 'x'.repeat(2e6) }),
        });
        expect(res.statusCode).toBe(413);
      });
    });

    describe('safety', () => {
      it.each([
        '../../etc/passwd',
        'photo/../../x.png',
        '/etc/passwd',
        'photo/user/..%2Fx.png',
        'photo/user/a.png/../b.png',
        'photo\\user\\a.png',
      ])('never touches the disk for the key %s', async (key) => {
        await expect(storage.head(key)).rejects.toThrow(BadRequestException);
        await expect(storage.delete(key)).rejects.toThrow(BadRequestException);
      });

      it('answers 404 for a signed link to a missing object', async () => {
        const t = await ticket();
        const res = await transfer(app, await storage.presignDownload(t.key));
        expect(res.status).toBe(404);
      });

      it('deletes the object with its metadata', async () => {
        const t = await uploaded();
        await storage.delete(t.key);
        expect(await storage.head(t.key)).toBeNull();
        await expect(storage.delete(t.key)).resolves.toBeUndefined();
      });

      it('needs query parameters on both endpoints', async () => {
        expect((await transfer(app, '/api/v1/files/download')).status).toBe(
          400,
        );
        expect(
          (
            await transfer(app, '/api/v1/files/upload', {
              method: 'PUT',
              body: bytes,
              headers: { 'Content-Type': 'image/png' },
            })
          ).status,
        ).toBe(400);
      });
    });
  },
);
