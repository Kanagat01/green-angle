import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import type { Attachment } from '../generated/prisma/client.js';
import { AttachmentKind } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from './storage.service.js';
import { normalizeMime, UPLOAD_RULES } from './upload-rules.js';

export interface CreateAttachmentInput {
  key: string;
  kind: AttachmentKind;
  vehicleStepId?: string;
  messageId?: string;
}

export interface AttachmentView {
  id: string;
  kind: AttachmentKind;
  mime: string;
  size: number;
  createdAt: Date;
  /** Короткоживущая presigned GET-ссылка */
  url: string;
}

@Injectable()
export class AttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
  ) {}

  /**
   * Регистрирует загруженный в S3 объект как вложение. Метаданные берутся из самого
   * хранилища, а не от клиента: объект должен существовать, ключ — принадлежать
   * пользователю и виду вложения, mime и размер — укладываться в лимиты.
   */
  async createFromUpload(
    user: AuthUser,
    input: CreateAttachmentInput,
  ): Promise<Attachment> {
    if (!input.key.startsWith(this.storage.keyPrefix(input.kind, user.id))) {
      throw new BadRequestException('Invalid attachment key');
    }

    const object = await this.storage.head(input.key);
    if (!object) throw new BadRequestException('Uploaded object not found');

    const mime = normalizeMime(object.contentType);
    const rule = UPLOAD_RULES[input.kind];
    if (
      !(mime in rule.mimes) ||
      object.size <= 0 ||
      object.size > rule.maxSize
    ) {
      throw new BadRequestException('Uploaded object violates upload limits');
    }

    const existing = await this.prisma.attachment.findUnique({
      where: { key: input.key },
    });
    if (existing) throw new ConflictException('Attachment already registered');

    return this.prisma.attachment.create({
      data: {
        key: input.key,
        mime,
        size: object.size,
        kind: input.kind,
        uploadedById: user.id,
        vehicleStepId: input.vehicleStepId,
        messageId: input.messageId,
      },
    });
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
