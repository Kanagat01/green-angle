import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { clientScope } from '../common/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import {
  MessageType,
  RequestStatus,
  Role,
} from '../generated/prisma/client.js';
import { MessagesService } from '../messages/messages.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { PushService } from '../push/push.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { initialSteps, stepTitle } from '../vehicles/steps.catalog.js';
import { VehiclesService } from '../vehicles/vehicles.service.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { firstMessageText } from './first-message.js';
import {
  ApproveRequestResultDto,
  LastMessageDto,
  RequestCountsDto,
  RequestListDto,
  RequestViewDto,
} from './dto/request-views.dto.js';

export interface RequestFilters {
  status?: RequestStatus;
  clientId?: string;
  /** Только ждущие ответа (true) или только остальные (false) */
  awaiting?: boolean;
  limit: number;
  offset: number;
}

/** Сколько символов текста последнего сообщения отдаётся в списках */
const LAST_MESSAGE_PREVIEW = 200;

const include = {
  client: { select: { id: true, type: true, name: true } },
} satisfies Prisma.RequestInclude;

type RequestWithClient = Prisma.RequestGetPayload<{ include: typeof include }>;

@Injectable()
export class RequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly messages: MessagesService,
    private readonly vehicles: VehiclesService,
    private readonly realtime: RealtimeService,
    private readonly push: PushService,
  ) {}

  /** Заявка на подбор от имени своего клиента. Статус всегда NEW. */
  async create(user: AuthUser, dto: CreateRequestDto): Promise<RequestViewDto> {
    const { clientId } = clientScope(user);
    // ADMIN не привязан к клиенту и заявки не создаёт
    if (!clientId) throw new ForbiddenException();

    // Диалог начинается с самой заявки: первое сообщение клиента пишется вместе с ней,
    // поэтому в очереди менеджера у заявки сразу есть последнее сообщение и «ждёт ответа»
    const created = await this.prisma.request.create({
      data: {
        clientId,
        createdById: user.id,
        title: dto.title,
        yearFrom: dto.yearFrom,
        budget: dto.budget,
        comment: dto.comment,
        messages: {
          create: {
            authorId: user.id,
            type: MessageType.TEXT,
            text: firstMessageText(dto),
          },
        },
      },
      include,
    });
    this.realtime.requestUpdated({
      requestId: created.id,
      clientId,
      status: created.status,
      vehicleId: null,
      reason: 'CREATED',
      at: created.createdAt.toISOString(),
    });
    // Новая заявка — это первое сообщение клиента: сотрудникам уходит push
    const first = await this.prisma.message.findFirst({
      where: { requestId: created.id },
      select: { id: true },
    });
    if (first) this.push.notifyMessage(first.id);
    return this.get(user, created.id);
  }

  /**
   * Список заявок. Изоляция по клиенту применяется последней: для BROKER/INDIVIDUAL она
   * перекрывает любой переданный clientId, ADMIN видит всё и может фильтровать.
   */
  async list(user: AuthUser, filters: RequestFilters): Promise<RequestListDto> {
    const where: Prisma.RequestWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...(filters.awaiting === undefined
        ? {}
        : { awaitingReply: filters.awaiting }),
      ...clientScope(user),
    };
    // Очередь менеджера: ждущие ответа сверху, дальше по свежести переписки.
    // Клиенту удобнее хронология: новые заявки первыми.
    const orderBy: Prisma.RequestOrderByWithRelationInput[] =
      user.role === Role.ADMIN
        ? [
            { awaitingReply: 'desc' },
            { lastMessageAt: { sort: 'desc', nulls: 'last' } },
            { createdAt: 'desc' },
            { id: 'asc' },
          ]
        : [{ createdAt: 'desc' }, { id: 'asc' }];

    const [items, total] = await Promise.all([
      this.prisma.request.findMany({
        where,
        include,
        orderBy,
        take: filters.limit,
        skip: filters.offset,
      }),
      this.prisma.request.count({ where }),
    ]);
    const ids = items.map((r) => r.id);
    const [unread, last] = await Promise.all([
      this.messages.unreadByRequest(user, ids),
      this.lastMessages(ids),
    ]);
    return {
      items: items.map((r) =>
        toView(r, unread.get(r.id) ?? 0, last.get(r.id) ?? null),
      ),
      total,
    };
  }

  /** Счётчики очереди для вкладок «Ждут ответа / Все» и бейджа в меню. */
  async counts(): Promise<RequestCountsDto> {
    const [awaitingReply, total] = await Promise.all([
      this.prisma.request.count({ where: { awaitingReply: true } }),
      this.prisma.request.count(),
    ]);
    return { awaitingReply, total };
  }

  /** Последнее сообщение каждой заявки: requestId → превью (заявки без сообщений не включаются). */
  private async lastMessages(
    requestIds: string[],
  ): Promise<Map<string, LastMessageDto>> {
    if (requestIds.length === 0) return new Map();
    const rows = await this.prisma.message.findMany({
      where: { requestId: { in: requestIds } },
      distinct: ['requestId'],
      orderBy: [{ requestId: 'asc' }, { createdAt: 'desc' }, { id: 'desc' }],
      include: {
        author: { select: { role: true } },
        _count: { select: { attachments: true, sharedAttachments: true } },
      },
    });
    return new Map(
      rows.map((m) => [
        m.requestId,
        {
          type: m.type,
          text: m.text === null ? null : m.text.slice(0, LAST_MESSAGE_PREVIEW),
          hasAttachments: m._count.attachments + m._count.sharedAttachments > 0,
          author: m.author
            ? m.author.role === Role.ADMIN
              ? 'MANAGER'
              : 'CLIENT'
            : 'SYSTEM',
          createdAt: m.createdAt,
        },
      ]),
    );
  }

  async get(user: AuthUser, id: string): Promise<RequestViewDto> {
    const request = await this.prisma.request.findFirst({
      where: { id, ...clientScope(user) },
      include,
    });
    // 404, а не 403: не раскрываем существование чужих заявок
    if (!request) throw new NotFoundException('Request not found');
    const [unread, last] = await Promise.all([
      this.messages.unreadByRequest(user, [id]),
      this.lastMessages([id]),
    ]);
    return toView(request, unread.get(id) ?? 0, last.get(id) ?? null);
  }

  /**
   * Одобрение заявки менеджером: заявка → APPROVED и создаётся машина (шаг 1, без VIN, клиент
   * заявки) со ссылкой Request.vehicleId — всё в одной транзакции. Идемпотентно: у заявки,
   * к которой машина уже привязана, повторный вызов возвращает ту же машину и ничего не создаёт.
   */
  async approve(admin: AuthUser, id: string): Promise<ApproveRequestResultDto> {
    const approval = await this.prisma.$transaction(async (tx) => {
      // Блокировка строки: сериализует параллельные approve и запись сообщений (см. MessagesService)
      const [locked] = await tx.$queryRaw<
        {
          vehicleId: string | null;
          clientId: string;
          title: string;
          status: RequestStatus;
        }[]
      >`SELECT "vehicleId", "clientId", "title", "status" FROM "Request"
          WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException('Request not found');
      if (locked.vehicleId) {
        return {
          vehicleId: locked.vehicleId,
          clientId: locked.clientId,
          created: false as const,
        };
      }
      if (locked.status === RequestStatus.REJECTED) {
        throw new ConflictException('A rejected request cannot be approved');
      }

      const vehicle = await tx.vehicle.create({
        data: {
          clientId: locked.clientId,
          title: locked.title,
          vin: null,
          currentStep: 1,
          steps: { create: initialSteps(1, new Date()) },
          statusLogs: {
            create: { fromStep: null, toStep: 1, changedById: admin.id },
          },
        },
        select: { id: true },
      });
      await tx.request.update({
        where: { id },
        data: { status: RequestStatus.APPROVED, vehicleId: vehicle.id },
      });
      const systemMessageId = await this.messages.createSystem(
        tx,
        id,
        `Менеджер одобрил вариант и создал заказ. Статус: «${stepTitle(1)}».`,
      );
      return {
        vehicleId: vehicle.id,
        clientId: locked.clientId,
        created: true as const,
        systemMessageId,
      };
    });

    // События только о реальном изменении: повторное одобрение ничего не рассылает
    if (approval.created) {
      await this.messages.announce([approval.systemMessageId]);
      const at = new Date().toISOString();
      this.realtime.requestUpdated({
        requestId: id,
        clientId: approval.clientId,
        status: RequestStatus.APPROVED,
        vehicleId: approval.vehicleId,
        reason: 'APPROVED',
        at,
      });
      this.realtime.vehicleStatusChanged({
        vehicleId: approval.vehicleId,
        clientId: approval.clientId,
        fromStep: null,
        toStep: 1,
        toStepTitle: stepTitle(1),
        declarationNumber: null,
        at,
      });
    }

    return {
      request: await this.get(admin, id),
      vehicle: await this.vehicles.getCard(admin, approval.vehicleId),
    };
  }

  /**
   * Отклонение заявки менеджером: NEW / IN_DIALOG → REJECTED, диалог становится только для
   * чтения. Идемпотентно: повторный вызов ничего не меняет и не рассылает. Одобренную заявку
   * отклонить нельзя (409). Та же блокировка строки, что у approve и записи сообщений.
   */
  async reject(admin: AuthUser, id: string): Promise<RequestViewDto> {
    const result = await this.prisma.$transaction(async (tx) => {
      const [locked] = await tx.$queryRaw<
        { status: RequestStatus; clientId: string }[]
      >`SELECT "status", "clientId" FROM "Request"
          WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException('Request not found');
      if (locked.status === RequestStatus.REJECTED) {
        return { changed: false as const, clientId: locked.clientId };
      }
      if (locked.status === RequestStatus.APPROVED) {
        throw new ConflictException('An approved request cannot be rejected');
      }
      await tx.request.update({
        where: { id },
        data: { status: RequestStatus.REJECTED },
      });
      const systemMessageId = await this.messages.createSystem(
        tx,
        id,
        'Менеджер отклонил заявку.',
      );
      return {
        changed: true as const,
        clientId: locked.clientId,
        systemMessageId,
      };
    });

    if (result.changed) {
      await this.messages.announce([result.systemMessageId]);
      this.realtime.requestUpdated({
        requestId: id,
        clientId: result.clientId,
        status: RequestStatus.REJECTED,
        vehicleId: null,
        reason: 'REJECTED',
        at: new Date().toISOString(),
      });
    }
    return this.get(admin, id);
  }
}

function toView(
  r: RequestWithClient,
  unreadCount: number,
  lastMessage: LastMessageDto | null,
): RequestViewDto {
  return {
    id: r.id,
    title: r.title,
    yearFrom: r.yearFrom,
    budget: r.budget === null ? null : r.budget.toNumber(),
    comment: r.comment,
    status: r.status,
    vehicleId: r.vehicleId,
    client: r.client,
    unreadCount,
    awaitingReply: r.awaitingReply,
    lastMessage,
    createdAt: r.createdAt,
  };
}
