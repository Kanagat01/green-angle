import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { clientScope } from '../common/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  AttachmentKind,
  MessageType,
  RequestStatus,
  Role,
} from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  AttachmentsService,
  UploadRef,
} from '../storage/attachments.service.js';
import { StorageService } from '../storage/storage.service.js';
import { CreateMessageDto } from './dto/create-message.dto.js';
import {
  MessageListDto,
  MessageViewDto,
  UnreadCountDto,
} from './dto/message-views.dto.js';

const include = {
  author: { select: { id: true, role: true } },
  attachments: { orderBy: { createdAt: 'asc' } },
} satisfies Prisma.MessageInclude;

type MessageWithRelations = Prisma.MessageGetPayload<{
  include: typeof include;
}>;

const APPROVED_CONFLICT = 'The request is approved; the dialog is read-only';

@Injectable()
export class MessagesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly attachments: AttachmentsService,
    private readonly storage: StorageService,
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
   * в одобренной заявке (APPROVED) диалог только для чтения.
   */
  async create(
    user: AuthUser,
    requestId: string,
    dto: CreateMessageDto,
  ): Promise<MessageViewDto> {
    const request = await this.requireAccessibleRequest(user, requestId);
    if (request.status === RequestStatus.APPROVED) {
      throw new ConflictException(APPROVED_CONFLICT);
    }

    const content = this.buildContent(dto);

    // Проверка файлов в S3 — до транзакции: сеть не должна держать блокировку
    const verified = await this.attachments.verify(user, content.refs);

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        // Блокировка строки заявки сериализует запись с одобрением заявки
        const [locked] = await tx.$queryRaw<{ status: RequestStatus }[]>`
          SELECT "status" FROM "Request" WHERE "id" = ${requestId}::uuid FOR UPDATE`;
        if (!locked) throw new NotFoundException('Request not found');
        if (locked.status === RequestStatus.APPROVED) {
          throw new ConflictException(APPROVED_CONFLICT);
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

        if (user.role === Role.ADMIN && locked.status === RequestStatus.NEW) {
          await tx.request.update({
            where: { id: requestId },
            data: { status: RequestStatus.IN_DIALOG },
          });
        }

        return tx.message.findUniqueOrThrow({
          where: { id: message.id },
          include,
        });
      });
      return this.toView(created, user);
    } catch (err) {
      if ((err as { code?: string } | null)?.code === 'P2002') {
        throw new ConflictException('Attachment already registered');
      }
      throw err;
    }
  }

  /**
   * Presigned PUT для голосового сообщения: тот же презайн, что и у /uploads/presign для AUDIO,
   * но с проверкой доступа к заявке. В одобренной заявке голосовое отправить нельзя.
   */
  async createVoiceUploadUrl(
    user: AuthUser,
    requestId: string,
    mime: string,
    size: number,
  ) {
    const request = await this.requireAccessibleRequest(user, requestId);
    if (request.status === RequestStatus.APPROVED) {
      throw new ConflictException(APPROVED_CONFLICT);
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

  /** Непрочитанное = написано не мной и без моей отметки о прочтении. */
  private unreadWhere(
    user: AuthUser,
    extra: Prisma.MessageWhereInput,
  ): Prisma.MessageWhereInput {
    return {
      ...extra,
      authorId: { not: user.id },
      reads: { none: { userId: user.id } },
    };
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
      select: { id: true, status: true },
    });
    if (!request) throw new NotFoundException('Request not found');
    return request;
  }

  private async toView(
    m: MessageWithRelations,
    user: AuthUser,
  ): Promise<MessageViewDto> {
    return {
      id: m.id,
      requestId: m.requestId,
      type: m.type,
      text: m.text,
      links: m.links,
      durationSec: m.durationSec,
      attachments: await Promise.all(
        m.attachments.map((a) => this.attachments.toView(a)),
      ),
      author: m.author,
      isMine: m.authorId === user.id,
      createdAt: m.createdAt,
    };
  }
}
