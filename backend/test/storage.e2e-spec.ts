import { BadRequestException, ConflictException } from '@nestjs/common';
import { NestFastifyApplication } from '@nestjs/platform-fastify';
import type { AuthUser } from '../src/auth/auth-user.js';
import { Role } from '../src/generated/prisma/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { AttachmentsService } from '../src/storage/attachments.service.js';
import { StorageService } from '../src/storage/storage.service.js';
import { createApp, createFixtures, Fixtures } from './helpers.js';

/**
 * Интеграционный тест против настоящего S3 (MinIO из docker compose).
 * Локально пропускается, если S3 недоступен; в CI (CI=true) недоступность S3 — это падение.
 */
const s3Up = await fetch(process.env.S3_ENDPOINT!, {
  signal: AbortSignal.timeout(2000),
})
  .then(() => true)
  .catch(() => false);

describe.runIf(s3Up || !!process.env.CI)('Storage with real S3', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let storage: StorageService;
  let attachments: AttachmentsService;
  let fx: Fixtures;
  let user: AuthUser;
  let otherUser: AuthUser;
  const createdKeys: string[] = [];

  const put = (url: string, body: Uint8Array, contentType: string) =>
    fetch(url, {
      method: 'PUT',
      body: body as BodyInit,
      headers: { 'Content-Type': contentType },
    });

  /** Выдаёт ticket и загружает в S3 `bytes` с указанным типом. */
  async function upload(
    owner: AuthUser,
    kind: 'PHOTO' | 'AUDIO',
    mime: string,
    bytes: Uint8Array,
  ) {
    const ticket = await storage.createUploadTicket(
      owner.id,
      kind,
      mime,
      bytes.length,
    );
    createdKeys.push(ticket.key);
    const res = await put(
      ticket.uploadUrl,
      bytes,
      ticket.headers['Content-Type'],
    );
    expect(res.ok).toBe(true);
    return ticket;
  }

  beforeAll(async () => {
    app = await createApp();
    prisma = app.get(PrismaService);
    storage = app.get(StorageService);
    attachments = app.get(AttachmentsService);
    fx = await createFixtures(prisma);
    user = {
      id: fx.broker.id,
      role: Role.BROKER,
      clientId: fx.broker.clientId,
    };
    otherUser = {
      id: fx.otherBroker.id,
      role: Role.BROKER,
      clientId: fx.otherBroker.clientId,
    };
  });

  afterAll(async () => {
    await prisma.attachment.deleteMany({
      where: { uploadedById: { in: [fx.broker.id, fx.otherBroker.id] } },
    });
    await Promise.all(createdKeys.map((key) => storage.delete(key)));
    await fx.cleanup();
    await app.close();
  });

  it('uploads via presigned URL, registers the attachment and serves it back', async () => {
    const bytes = new TextEncoder().encode('fake-opus-audio-bytes');
    const ticket = await upload(user, 'AUDIO', 'audio/webm;codecs=opus', bytes);

    const attachment = await attachments.createFromUpload(user, {
      key: ticket.key,
      kind: 'AUDIO',
    });
    expect(attachment).toMatchObject({
      key: ticket.key,
      kind: 'AUDIO',
      mime: 'audio/webm',
      size: bytes.length,
      uploadedById: user.id,
    });

    const view = await attachments.toView(attachment);
    const download = await fetch(view.url);
    expect(download.ok).toBe(true);
    expect(new Uint8Array(await download.arrayBuffer())).toEqual(bytes);
  });

  it('refuses an upload whose size differs from the one declared at presign', async () => {
    const ticket = await storage.createUploadTicket(
      user.id,
      'PHOTO',
      'image/png',
      10,
    );
    createdKeys.push(ticket.key);
    const res = await put(ticket.uploadUrl, new Uint8Array(20), 'image/png');
    expect(res.ok).toBe(false);
    expect(await storage.head(ticket.key)).toBeNull();
  });

  it('refuses an upload with a different Content-Type', async () => {
    const ticket = await storage.createUploadTicket(
      user.id,
      'PHOTO',
      'image/png',
      10,
    );
    createdKeys.push(ticket.key);
    const res = await put(ticket.uploadUrl, new Uint8Array(10), 'text/html');
    expect(res.ok).toBe(false);
    expect(await storage.head(ticket.key)).toBeNull();
  });

  it('rejects registering a key that was never uploaded', async () => {
    const ticket = await storage.createUploadTicket(
      user.id,
      'PHOTO',
      'image/png',
      10,
    );
    await expect(
      attachments.createFromUpload(user, { key: ticket.key, kind: 'PHOTO' }),
    ).rejects.toThrow(BadRequestException);
  });

  it("rejects registering another user's key", async () => {
    const ticket = await upload(
      otherUser,
      'PHOTO',
      'image/png',
      new Uint8Array(10),
    );
    await expect(
      attachments.createFromUpload(user, { key: ticket.key, kind: 'PHOTO' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects registering a key under a different kind', async () => {
    const ticket = await upload(user, 'PHOTO', 'image/png', new Uint8Array(10));
    await expect(
      attachments.createFromUpload(user, { key: ticket.key, kind: 'AUDIO' }),
    ).rejects.toThrow(BadRequestException);
  });

  it('rejects registering the same object twice', async () => {
    const ticket = await upload(user, 'PHOTO', 'image/png', new Uint8Array(10));
    await attachments.createFromUpload(user, {
      key: ticket.key,
      kind: 'PHOTO',
    });
    await expect(
      attachments.createFromUpload(user, { key: ticket.key, kind: 'PHOTO' }),
    ).rejects.toThrow(ConflictException);
  });
});
