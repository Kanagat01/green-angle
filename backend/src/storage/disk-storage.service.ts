import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  OnModuleInit,
  PayloadTooLargeException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { constants, createReadStream, createWriteStream } from 'node:fs';
import {
  access,
  copyFile,
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import { Transform, type Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import {
  StorageService,
  type StoredObject,
  type UploadTicket,
} from './storage.service.js';

/** Префикс API; ссылки без FILES_PUBLIC_URL относительны этому префиксу */
const API_PREFIX = '/api/v1';

/** Ключ: `{вид}/{id пользователя}/{uuid}.{расширение}` — других путей на диске не бывает */
const KEY_PATTERN = /^[a-z]+\/[A-Za-z0-9_-]+\/[A-Za-z0-9_-]+\.[a-z0-9]{1,5}$/;

export interface OpenedObject extends StoredObject {
  stream: Readable;
}

/**
 * Драйвер диска сервера. Протокол тот же, что у S3: API выдаёт подписанную ссылку на загрузку
 * (PUT) и скачивание (GET), только ведёт она на `/files/upload` и `/files/download` самого API.
 * Подпись (HMAC) фиксирует метод, ключ, срок действия, а для загрузки ещё тип и размер файла.
 */
export class DiskStorageService extends StorageService implements OnModuleInit {
  private readonly logger = new Logger(DiskStorageService.name);
  private readonly root: string;
  private readonly secret: string;
  private readonly baseUrl: string;
  private readonly putTtl: number;
  private readonly getTtl: number;

  constructor(config: ConfigService) {
    super();
    this.root = resolve(config.getOrThrow<string>('UPLOAD_DIR'));
    this.secret = config.getOrThrow<string>('FILES_SIGNING_SECRET');
    const publicUrl = config.get<string>('FILES_PUBLIC_URL');
    this.baseUrl = (publicUrl || API_PREFIX).replace(/\/+$/, '');
    this.putTtl = config.getOrThrow<number>('UPLOAD_URL_TTL_SEC');
    this.getTtl = config.getOrThrow<number>('DOWNLOAD_URL_TTL_SEC');
  }

  async onModuleInit() {
    try {
      await mkdir(this.root, { recursive: true });
    } catch (err) {
      this.logger.warn(
        `Cannot create upload directory "${this.root}": ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
    }
  }

  protected signUpload(
    key: string,
    contentType: string,
    size: number,
  ): Promise<UploadTicket> {
    const exp = this.expiry(this.putTtl);
    const sig = this.sign('PUT', key, exp, contentType, size);
    const query = new URLSearchParams({
      key,
      exp: String(exp),
      type: contentType,
      size: String(size),
      sig,
    });
    return Promise.resolve({
      key,
      uploadUrl: `${this.baseUrl}/files/upload?${query}`,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresIn: this.putTtl,
    });
  }

  presignDownload(key: string): Promise<string> {
    const exp = this.expiry(this.getTtl);
    const query = new URLSearchParams({
      key,
      exp: String(exp),
      sig: this.sign('GET', key, exp),
    });
    return Promise.resolve(`${this.baseUrl}/files/download?${query}`);
  }

  /** Проверяет подпись и срок ссылки; при любом расхождении — 403 без подробностей. */
  assertSignature(
    method: 'PUT' | 'GET',
    params: {
      key: string;
      exp: number;
      sig: string;
      type?: string;
      size?: number;
    },
  ) {
    const expected = this.sign(
      method,
      params.key,
      params.exp,
      params.type,
      params.size,
    );
    const a = Buffer.from(expected);
    const b = Buffer.from(params.sig);
    const valid = a.length === b.length && timingSafeEqual(a, b);
    if (
      !valid ||
      params.exp * 1000 < Date.now() ||
      !KEY_PATTERN.test(params.key)
    ) {
      throw new ForbiddenException('Invalid or expired link');
    }
  }

  /**
   * Записывает загруженный поток: размер должен совпасть с подписанным, повторная запись в
   * тот же ключ запрещена. Файл появляется атомарно (запись во временный файл, затем rename).
   */
  async store(
    key: string,
    body: Readable,
    contentType: string,
    size: number,
  ): Promise<void> {
    const path = this.pathFor(key);
    if (await exists(path)) {
      throw new ConflictException('Object already uploaded');
    }
    await mkdir(dirname(path), { recursive: true });

    const tmp = `${path}.${randomUUID()}.part`;
    let received = 0;
    const counter = new Transform({
      transform(chunk: Buffer, _enc, done) {
        received += chunk.length;
        done(received > size ? new PayloadTooLargeException() : null, chunk);
      },
    });

    try {
      await pipeline(body, counter, createWriteStream(tmp, { flags: 'wx' }));
      if (received !== size) {
        throw new BadRequestException(
          'Body size differs from the declared one',
        );
      }
      // Сначала метаданные, потом файл: если файл виден, то тип у него уже записан
      await writeFile(this.metaPath(path), JSON.stringify({ contentType }));
      await rename(tmp, path);
    } catch (err) {
      await rm(tmp, { force: true });
      await rm(this.metaPath(path), { force: true });
      throw err;
    }
  }

  /** Открывает объект для отдачи (весь или диапазон байт). */
  async open(
    key: string,
    range?: { start: number; end: number },
  ): Promise<OpenedObject | null> {
    const object = await this.head(key);
    if (!object) return null;
    return {
      ...object,
      stream: createReadStream(this.pathFor(key), range),
    };
  }

  async downloadToFile(key: string, filePath: string): Promise<void> {
    await copyFile(this.pathFor(key), filePath);
  }

  async ping(): Promise<void> {
    await access(this.root, constants.R_OK | constants.W_OK);
  }

  async delete(key: string): Promise<void> {
    const path = this.pathFor(key);
    await rm(path, { force: true });
    await rm(this.metaPath(path), { force: true });
  }

  async head(key: string): Promise<StoredObject | null> {
    const path = this.pathFor(key);
    try {
      const [info, meta] = await Promise.all([
        stat(path),
        readFile(this.metaPath(path), 'utf8'),
      ]);
      if (!info.isFile()) return null;
      const { contentType } = JSON.parse(meta) as { contentType?: string };
      return { size: info.size, contentType: contentType ?? '' };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return null;
      throw err;
    }
  }

  /** Путь к файлу внутри каталога хранилища; ключи вне формата и выход за каталог отклоняются. */
  private pathFor(key: string): string {
    if (!KEY_PATTERN.test(key)) {
      throw new BadRequestException('Invalid object key');
    }
    const path = resolve(this.root, ...key.split('/'));
    if (!path.startsWith(this.root + sep)) {
      throw new BadRequestException('Invalid object key');
    }
    return path;
  }

  private metaPath(path: string): string {
    return `${path}.meta`;
  }

  private expiry(ttlSec: number): number {
    return Math.floor(Date.now() / 1000) + ttlSec;
  }

  private sign(
    method: string,
    key: string,
    exp: number,
    contentType = '',
    size: number | string = '',
  ): string {
    return createHmac('sha256', this.secret)
      .update([method, key, exp, contentType, size].join('\n'))
      .digest('base64url');
  }
}

async function exists(path: string): Promise<boolean> {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}
