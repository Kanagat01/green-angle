import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import {
  AudioProbeError,
  AudioProbeService,
} from '../audio/audio-probe.service.js';
import { clientScope } from '../common/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  AttachmentKind,
  MessageType,
  RequestStatus,
  Role,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import type { SharedMessage } from '../realtime/realtime.events.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import {
  AttachmentsService,
  UploadRef,
  VerifiedUpload,
} from '../storage/attachments.service.js';
import { StorageService } from '../storage/storage.service.js';
import {
  CreateMessageDto,
  MAX_VOICE_SECONDS,
} from './dto/create-message.dto.js';
import {
  MessageListDto,
  MessageViewDto,
  UnreadCountDto,
} from './dto/message-views.dto.js';

const include = {
  author: { select: { id: true, role: true } },
  attachments: { orderBy: { createdAt: 'asc' } },
  // вложения шагов машины, показанные в комментарии менеджера при смене статуса
  sharedAttachments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.MessageInclude;

type MessageWithRelations = Prisma.MessageGetPayload<{
  include: typeof include;
}>;

const CLOSED_CONFLICT =
  'The request is closed (approved or rejected); the dialog is read-only';

/** Закрытая заявка (одобрена или отклонена): диалог только для чтения. */
const isClosed = (status: RequestStatus) =>
  status === RequestStatus.APPROVED || status === RequestStatus.REJECTED;

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly storage: StorageService,
    private readonly realtime: RealtimeService,
    private readonly audioProbe: AudioProbeService,
  ) {}

  /** Лента сообщений: страница до курсора `before` (или последние), от старых к новым. */
  async list(
    user: AuthUser,
    requestId: string,
    query: { limit: number; before?: string },
  ): Promise<MessageListDto> {
    await this.requireAccessibleRequest(user, requestId);

    let cursorFilter: Prisma.MessageWhereInput = {};
    if (query.before) {
      const cursor = await this.prisma.message.findFirst({
        where: { id: query.before, requestId },
        select: { id: true, createdAt: true },
      });
      if (!cursor) throw new BadRequestException('Unknown cursor');
      cursorFilter = {
        OR: [
          { createdAt: { lt: cursor.createdAt } },
          { createdAt: cursor.createdAt, id: { lt: cursor.id } },
        ],
      };
    }

    const rows = await this.prisma.message.findMany({
      where: { requestId, ...cursorFilter },
      include,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
    });
    const page = rows.slice(0, query.limit).reverse();
    return {
      items: await Promise.all(page.map((m) => this.toView(m, user))),
      hasMore: rows.length > query.limit,
    };
  }

  /**
   * Новое сообщение. Первое сообщение менеджера переводит заявку NEW → IN_DIALOG;
   * в закрытой заявке (APPROVED, REJECTED) диалог только для чтения.
   */
  async create(
    user: AuthUser,
    requestId: string,
    dto: CreateMessageDto,
  ): Promise<MessageViewDto> {
    const request = await this.requireAccessibleRequest(user, requestId);
    if (isClosed(request.status)) {
      throw new ConflictException(CLOSED_CONFLICT);
    }

    const content = this.buildContent(dto);

    // Проверка файлов в хранилище — до транзакции: сеть не должна держать блокировку
    const verified = await this.attachments.verify(user, content.refs);

    if (content.type === MessageType.VOICE && this.audioProbe.enabled) {
      content.durationSec = await this.verifyVoiceDuration(
        verified[0],
        content.durationSec!,
      );
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Блокировка строки заявки сериализует запись с одобрением заявки
        const [locked] = await tx.$queryRaw<{ status: RequestStatus }[]>`
          SELECT "status" FROM "Request" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
        if (!locked) throw new NotFoundException('Request not found');
        if (isClosed(locked.status)) {
          throw new ConflictException(CLOSED_CONFLICT);
        }

        const message = await tx.message.create({
          data: {
            requestId,
            authorId: user.id,
            type: content.type,
            text: content.text,
            links: content.links,
            durationSec: content.durationSec,
          },
        });
        await this.attachments.createVerified(tx, user, verified, {
          messageId: message.id,
        });

        let status: RequestStatus = locked.status;
        if (user.role === Role.ADMIN && locked.status === RequestStatus.NEW) {
          status = RequestStatus.IN_DIALOG;
          await tx.request.update({
            where: { id: requestId },
            data: { status },
          });
        }

        return {
          status,
          message: await tx.message.findUniqueOrThrow({
            where: { id: message.id },
            include,
          }),
        };
      });

      // События — только после коммита: подписчики не должны увидеть то, чего потом нет в БД
      const shared = await this.toShared(created.message);
      this.realtime.messageCreated({ message: shared });
      this.realtime.requestUpdated({
        requestId,
        clientId: request.clientId,
        status: created.status,
        vehicleId: null,
        reason: 'MESSAGE',
        at: new Date().toISOString(),
      });
      return { ...shared, isMine: true };
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException('Attachment already registered');
      }
      throw err;
    }
  }

  /**
   * Presigned PUT для голосового сообщения: тот же презайн, что и у /uploads/presign для AUDIO,
   * но с проверкой доступа к заявке. В закрытой заявке голосовое отправить нельзя.
   */
  async createVoiceUploadUrl(
    user: AuthUser,
    requestId: string,
    mime: string,
    size: number,
  ) {
    const request = await this.requireAccessibleRequest(user, requestId);
    if (isClosed(request.status)) {
      throw new ConflictException(CLOSED_CONFLICT);
    }
    return this.storage.createUploadTicket(
      user.id,
      AttachmentKind.AUDIO,
      mime,
      size,
    );
  }

  /** Отмечает все чужие сообщения заявки прочитанными текущим пользователем. */
  async markRead(user: AuthUser, requestId: string): Promise<UnreadCountDto> {
    await this.requireAccessibleRequest(user, requestId);

    const unread = await this.prisma.message.findMany({
      where: this.unreadWhere(user, { requestId }),
      select: { id: true },
    });
    if (unread.length > 0) {
      await this.prisma.messageRead.createMany({
        data: unread.map((m) => ({ messageId: m.id, userId: user.id })),
        skipDuplicates: true,
      });
    }
    return { unreadCount: 0 };
  }

  /** Непрочитанные по заявкам: requestId → количество (заявки без непрочитанных не включаются). */
  async unreadByRequest(
    user: AuthUser,
    requestIds: string[],
  ): Promise<Map<string, number>> {
    if (requestIds.length === 0) return new Map();
    const groups = await this.prisma.message.groupBy({
      by: ['requestId'],
      where: this.unreadWhere(user, { requestId: { in: requestIds } }),
      _count: { _all: true },
    });
    return new Map(groups.map((g) => [g.requestId, g._count._all]));
  }

  /** Всего непрочитанных во всех доступных пользователю заявках. */
  async totalUnread(user: AuthUser): Promise<UnreadCountDto> {
    const unreadCount = await this.prisma.message.count({
      where: this.unreadWhere(user, { request: clientScope(user) }),
    });
    return { unreadCount };
  }

  /**
   * Служебная строка в диалоге («Менеджер одобрил…», «Статус машины: …»). Пишется в чужой
   * транзакции вместе с изменением, о котором сообщает; рассылка — отдельно, после коммита
   * (`announce`). Не считается непрочитанной и не меняет статус заявки.
   */
  async createSystem(
    tx: Prisma.TransactionClient,
    requestId: string,
    text: string,
    /** Время строки; по умолчанию — время начала транзакции (оно общее для всех её записей) */
    createdAt?: Date,
  ): Promise<string> {
    const created = await tx.message.create({
      data: {
        requestId,
        authorId: null,
        type: MessageType.SYSTEM,
        text,
        createdAt,
      },
      select: { id: true },
    });
    return created.id;
  }

  /** Рассылает созданные сообщения подписчикам заявок; вызывать после коммита транзакции. */
  async announce(messageIds: string[]): Promise<void> {
    if (messageIds.length === 0) return;
    const rows = await this.prisma.message.findMany({
      where: { id: { in: messageIds } },
      include,
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
    for (const row of rows) {
      this.realtime.messageCreated({ message: await this.toShared(row) });
    }
  }

  /** Непрочитанное = чужое сообщение людей (не служебное) без моей отметки о прочтении. */
  private unreadWhere(
    user: AuthUser,
    extra: Prisma.MessageWhereInput,
  ): Prisma.MessageWhereInput {
    return {
      ...extra,
      type: { not: MessageType.SYSTEM },
      authorId: { not: user.id },
      reads: { none: { userId: user.id } },
    };
  }

  /**
   * Сверяет заявленную клиентом длительность с реальной (ffprobe) и применяет лимит 5 минут
   * к настоящей длительности файла. Сохраняется измеренное значение, а не слова клиента.
   */
  private async verifyVoiceDuration(
    upload: VerifiedUpload,
    claimedSec: number,
  ): Promise<number> {
    let actual: number;
    try {
      actual = await this.audioProbe.measureObject(upload.key, upload.mime);
    } catch (err) {
      if (err instanceof AudioProbeError && err.reason === 'INVALID_AUDIO') {
        throw new BadRequestException(
          'The uploaded file is not a valid audio recording',
        );
      }
      throw new ServiceUnavailableException(
        'Audio verification is temporarily unavailable',
      );
    }

    const measured = Math.round(actual);
    if (measured < 1) {
      throw new BadRequestException('The recording is too short');
    }
    if (measured > MAX_VOICE_SECONDS) {
      throw new BadRequestException(
        `The recording is longer than ${MAX_VOICE_SECONDS} seconds`,
      );
    }
    // Допуск на округление и на то, как клиент измеряет запись
    if (Math.abs(actual - claimedSec) > Math.max(2, actual * 0.1)) {
      throw new BadRequestException(
        'durationSec does not match the uploaded recording',
      );
    }
    return measured;
  }

  /**
   * Приводит тело запроса к содержимому сообщения. TEXT — текст/ссылки/фото/файлы;
   * VOICE — только аудио (ключ + длительность), остальные поля недопустимы.
   */
  private buildContent(dto: CreateMessageDto): {
    type: MessageType;
    text: string | null;
    links: string[];
    durationSec: number | null;
    refs: UploadRef[];
  } {
    if (dto.type === MessageType.VOICE) {
      if (dto.text?.trim() || dto.links?.length || dto.attachments?.length) {
        throw new BadRequestException(
          'A voice message cannot contain text, links or attachments',
        );
      }
      return {
        type: MessageType.VOICE,
        text: null,
        links: [],
        durationSec: dto.durationSec!,
        refs: [{ key: dto.attachmentKey!, kind: AttachmentKind.AUDIO }],
      };
    }

    // Для TEXT поля voice-сообщения (attachmentKey, durationSec) игнорируются
    const text = dto.text?.trim() || null;
    const links = dto.links ?? [];
    const refs = dto.attachments ?? [];
    if (!text && links.length === 0 && refs.length === 0) {
      throw new BadRequestException(
        'Message must contain text, links or attachments',
      );
    }
    return { type: MessageType.TEXT, text, links, durationSec: null, refs };
  }

  /** Заявка в рамках доступа пользователя; чужая — 404, не 403. */
  private async requireAccessibleRequest(user: AuthUser, requestId: string) {
    const request = await this.prisma.request.findFirst({
      where: { id: requestId, ...clientScope(user) },
      select: { id: true, status: true, clientId: true },
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  private async toView(
    m: MessageWithRelations,
    user: AuthUser,
  ): Promise<MessageViewDto> {
    return { ...(await this.toShared(m)), isMine: m.authorId === user.id };
  }

  /** Представление, одинаковое для всех получателей (без isMine) — для realtime-рассылки. */
  private async toShared(m: MessageWithRelations): Promise<SharedMessage> {
    return {
      id: m.id,
      requestId: m.requestId,
      type: m.type,
      text: m.text,
      links: m.links,
      durationSec: m.durationSec,
      attachments: await Promise.all(
        [...m.attachments, ...m.sharedAttachments].map((a) =>
          this.attachments.toView(a),
        ),
      ),
      author: m.author,
      createdAt: m.createdAt,
    };
  }
}
