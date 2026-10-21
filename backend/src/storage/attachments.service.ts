import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import type { Attachment, Prisma } from '../generated/prisma/client.js';
import { AttachmentKind } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from './storage.service.js';
import { normalizeMime, UPLOAD_RULES } from './upload-rules.js';

export interface UploadRef {
  key: string;
  kind: AttachmentKind;
}

export interface CreateAttachmentInput extends UploadRef {
  vehicleStepId?: string;
  messageId?: string;
}

/** Загруженный объект, прошедший проверку; метаданные взяты из хранилища. */
export interface VerifiedUpload extends UploadRef {
  mime: string;
  size: number;
}

export interface AttachmentTarget {
  vehicleStepId?: string;
  messageId?: string;
}

export interface AttachmentView {
  id: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  createdAt: Date;
  /** Короткоживущая ссылка на скачивание (S3 или API, по драйверу) */
  url: string;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Проверяет загруженные в хранилище объекты. Метаданные берутся из самого хранилища, а не от
   * клиента: объект должен существовать, ключ — принадлежать пользователю и виду вложения,
   * mime и размер — укладываться в лимиты, объект — не быть уже зарегистрированным.
   * Ничего не записывает, поэтому вызывается до открытия транзакции.
   */
  async verify(user: AuthUser, refs: UploadRef[]): Promise<VerifiedUpload[]> {
    if (new Set(refs.map((r) => r.key)).size !== refs.length) {
      throw new BadRequestException('Duplicate attachment keys');
    }

    return Promise.all(
      refs.map(async (ref) => {
        if (!ref.key.startsWith(this.storage.keyPrefix(ref.kind, user.id))) {
          throw new BadRequestException('Invalid attachment key');
        }

        const object = await this.storage.head(ref.key);
        if (!object) {
          throw new BadRequestException('Uploaded object not found');
        }

        const mime = normalizeMime(object.contentType);
        const rule = UPLOAD_RULES[ref.kind];
        if (
          !(mime in rule.mimes) ||
          object.size <= 0 ||
          object.size > rule.maxSize
        ) {
          throw new BadRequestException(
            'Uploaded object violates upload limits',
          );
        }

        const existing = await this.prisma.attachment.findUnique({
          where: { key: ref.key },
          select: { id: true },
        });
        if (existing) {
          throw new ConflictException('Attachment already registered');
        }

        return { key: ref.key, kind: ref.kind, mime, size: object.size };
      }),
    );
  }

  /** Записывает проверенные вложения (в том числе внутри чужой транзакции). */
  async createVerified(
    db: Prisma.TransactionClient | PrismaService,
    user: AuthUser,
    verified: VerifiedUpload[],
    target: AttachmentTarget,
  ): Promise<Attachment[]> {
    return Promise.all(
      verified.map((v) =>
        db.attachment.create({
          data: {
            key: v.key,
            mime: v.mime,
            size: v.size,
            kind: v.kind,
            uploadedById: user.id,
            vehicleStepId: target.vehicleStepId,
            messageId: target.messageId,
          },
        }),
      ),
    );
  }

  /** Проверка и регистрация одного вложения. */
  async createFromUpload(
    user: AuthUser,
    input: CreateAttachmentInput,
  ): Promise<Attachment> {
    const verified = await this.verify(user, [input]);
    const [attachment] = await this.createVerified(
      this.prisma,
      user,
      verified,
      {
        vehicleStepId: input.vehicleStepId,
        messageId: input.messageId,
      },
    );
    return attachment;
  }

  /** Представление вложения для API: метаданные + свежая ссылка на скачивание. */
  async toView(attachment: Attachment): Promise<AttachmentView> {
    return {
      id: attachment.id,
      kind: attachment.kind,
      mime: attachment.mime,
      size: attachment.size,
      createdAt: attachment.createdAt,
      url: await this.storage.presignDownload(attachment.key),
    };
  }
}
