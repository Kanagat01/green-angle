import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { AttachmentKind } from '../generated/prisma/client.js';
import { validateUpload } from './upload-rules.js';

export interface UploadTicket {
  key: string;
  uploadUrl: string;
  method: 'PUT';
  /** Заголовки, которые клиент обязан отправить с PUT (подписаны в URL) */
  headers: Record<string, string>;
  expiresIn: number;
}

export interface StoredObject {
  size: number;
  contentType: string;
}

@Injectable()
export class StorageService implements OnModuleInit {
  private readonly logger = new Logger(StorageService.name);
  private readonly bucket: string;
  private readonly putTtl: number;
  private readonly getTtl: number;
  /** Клиент для операций сервера (внутренний адрес S3) */
  private readonly internal: S3Client;
  /** Клиент только для подписи URL (адрес, доступный браузеру) */
  private readonly signer: S3Client;

  constructor(config: ConfigService) {
    this.bucket = config.getOrThrow<string>('S3_BUCKET');
    this.putTtl = config.getOrThrow<number>('S3_PRESIGN_PUT_TTL_SEC');
    this.getTtl = config.getOrThrow<number>('S3_PRESIGN_GET_TTL_SEC');

    const endpoint = config.getOrThrow<string>('S3_ENDPOINT');
    const base = {
      region: config.getOrThrow<string>('S3_REGION'),
      forcePathStyle: true,
      credentials: {
        accessKeyId: config.getOrThrow<string>('S3_ACCESS_KEY'),
        secretAccessKey: config.getOrThrow<string>('S3_SECRET_KEY'),
      },
      // Без автоматических checksum-параметров в presigned URL (ломают прямую загрузку из браузера)
      requestChecksumCalculation: 'WHEN_REQUIRED' as const,
      responseChecksumValidation: 'WHEN_REQUIRED' as const,
    };
    this.internal = new S3Client({ ...base, endpoint });
    this.signer = new S3Client({
      ...base,
      endpoint: config.get<string>('S3_PUBLIC_ENDPOINT') ?? endpoint,
    });
  }

  /** Создаёт бакет, если его нет. Недоступность S3 не должна ронять API при старте. */
  async onModuleInit() {
    try {
      await this.internal.send(new HeadBucketCommand({ Bucket: this.bucket }));
    } catch (err) {
      if (!isNotFound(err)) {
        this.logger.warn(
          `S3 is not reachable, bucket check skipped: ${errorMessage(err)}`,
        );
        return;
      }
      try {
        await this.internal.send(
          new CreateBucketCommand({ Bucket: this.bucket }),
        );
        this.logger.log(`Bucket "${this.bucket}" created`);
      } catch (createErr) {
        this.logger.warn(
          `Cannot create bucket "${this.bucket}": ${errorMessage(createErr)}`,
        );
      }
    }
  }

  /** Префикс ключей, которые пользователь вправе использовать для данного вида вложений. */
  keyPrefix(kind: AttachmentKind, userId: string): string {
    return `${kind.toLowerCase()}/${userId}/`;
  }

  /** Проверяет mime/размер и выдаёт presigned PUT. Подпись фиксирует Content-Type и Content-Length. */
  async createUploadTicket(
    userId: string,
    kind: AttachmentKind,
    mime: string,
    size: number,
  ): Promise<UploadTicket> {
    const { mime: contentType, ext } = validateUpload(kind, mime, size);
    const key = `${this.keyPrefix(kind, userId)}${randomUUID()}.${ext}`;

    const uploadUrl = await getSignedUrl(
      this.signer,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        ContentType: contentType,
        ContentLength: size,
      }),
      {
        expiresIn: this.putTtl,
        signableHeaders: new Set(['content-type', 'content-length']),
      },
    );

    return {
      key,
      uploadUrl,
      method: 'PUT',
      headers: { 'Content-Type': contentType },
      expiresIn: this.putTtl,
    };
  }

  /** Короткоживущая ссылка на скачивание/воспроизведение. */
  presignDownload(key: string): Promise<string> {
    return getSignedUrl(
      this.signer,
      new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      { expiresIn: this.getTtl },
    );
  }

  async delete(key: string): Promise<void> {
    await this.internal.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: key }),
    );
  }

  /** Метаданные загруженного объекта или null, если объекта нет. */
  async head(key: string): Promise<StoredObject | null> {
    try {
      const res = await this.internal.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return {
        size: res.ContentLength ?? 0,
        contentType: res.ContentType ?? '',
      };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    e?.name === 'NotFound' ||
    e?.name === 'NoSuchKey' ||
    e?.name === 'NoSuchBucket' ||
    e?.$metadata?.httpStatusCode === 404
  );
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}
