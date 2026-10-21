import { randomUUID } from 'node:crypto';
import { AttachmentKind } from '../generated/prisma/client.js';
import { validateUpload } from './upload-rules.js';

export interface UploadTicket {
  key: string;
  /** Куда клиент отправляет файл: абсолютный адрес S3 или адрес API (может быть относительным) */
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

/**
 * Хранилище файлов. Остальной код (вложения, сообщения, проверка голосовых) знает только этот
 * контракт, поэтому драйвер (диск или S3) меняется переменной `STORAGE_DRIVER` без правок в
 * клиентах: в обоих случаях presign → PUT по выданной ссылке → регистрация ключа → скачивание
 * по короткоживущей ссылке.
 */
export abstract class StorageService {
  /** Префикс ключей, которые пользователь вправе использовать для данного вида вложений. */
  keyPrefix(kind: AttachmentKind, userId: string): string {
    return `${kind.toLowerCase()}/${userId}/`;
  }

  /** Проверяет mime/размер и выдаёт ссылку для загрузки; подпись фиксирует Content-Type и размер. */
  async createUploadTicket(
    userId: string,
    kind: AttachmentKind,
    mime: string,
    size: number,
  ): Promise<UploadTicket> {
    const { mime: contentType, ext } = validateUpload(kind, mime, size);
    const key = `${this.keyPrefix(kind, userId)}${randomUUID()}.${ext}`;
    return this.signUpload(key, contentType, size);
  }

  /** Подписанная ссылка на загрузку объекта `key` (драйвер-специфичная часть). */
  protected abstract signUpload(
    key: string,
    contentType: string,
    size: number,
  ): Promise<UploadTicket>;

  /** Короткоживущая ссылка на скачивание/воспроизведение. */
  abstract presignDownload(key: string): Promise<string>;

  /** Копирует объект в локальный файл (потоком, без загрузки целиком в память). */
  abstract downloadToFile(key: string, filePath: string): Promise<void>;

  /** Проверка доступности хранилища (для readiness). Бросает ошибку, если недоступно. */
  abstract ping(): Promise<void>;

  abstract delete(key: string): Promise<void>;

  /** Метаданные загруженного объекта или null, если объекта нет. */
  abstract head(key: string): Promise<StoredObject | null>;
}
