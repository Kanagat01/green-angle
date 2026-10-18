import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { clientScope } from '../common/scope.js';
import type { Prisma } from '../generated/prisma/client.js';
import { RequestStatus } from '../generated/prisma/client.js';
import { MessagesService } from '../messages/messages.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { initialSteps } from '../vehicles/steps.catalog.js';
import { VehiclesService } from '../vehicles/vehicles.service.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import {
  ApproveRequestResultDto,
  RequestListDto,
  RequestViewDto,
} from './dto/request-views.dto.js';

export interface RequestFilters {
  status?: RequestStatus;
  clientId?: string;
  limit: number;
  offset: number;
}

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
  ) {}

  /** Заявка на подбор от имени своего клиента. Статус всегда NEW. */
  async create(user: AuthUser, dto: CreateRequestDto): Promise<RequestViewDto> {
    const { clientId } = clientScope(user);
    // ADMIN не привязан к клиенту и заявки не создаёт
    if (!clientId) throw new ForbiddenException();

    const created = await this.prisma.request.create({
      data: {
        clientId,
        createdById: user.id,
        title: dto.title,
        yearFrom: dto.yearFrom,
        budget: dto.budget,
        comment: dto.comment,
      },
      include,
    });
    return toView(created, 0);
  }

  /**
   * Список заявок. Изоляция по клиенту применяется последней: для BROKER/INDIVIDUAL она
   * перекрывает любой переданный clientId, ADMIN видит всё и может фильтровать.
   */
  async list(user: AuthUser, filters: RequestFilters): Promise<RequestListDto> {
    const where: Prisma.RequestWhereInput = {
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.clientId ? { clientId: filters.clientId } : {}),
      ...clientScope(user),
    };

    const [items, total] = await Promise.all([
      this.prisma.request.findMany({
        where,
        include,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: filters.limit,
        skip: filters.offset,
      }),
      this.prisma.request.count({ where }),
    ]);
    const unread = await this.messages.unreadByRequest(
      user,
      items.map((r) => r.id),
    );
    return {
      items: items.map((r) => toView(r, unread.get(r.id) ?? 0)),
      total,
    };
  }

  async get(user: AuthUser, id: string): Promise<RequestViewDto> {
    const request = await this.prisma.request.findFirst({
      where: { id, ...clientScope(user) },
      include,
    });
    // 404, а не 403: не раскрываем существование чужих заявок
    if (!request) throw new NotFoundException('Request not found');
    const unread = await this.messages.unreadByRequest(user, [id]);
    return toView(request, unread.get(id) ?? 0);
  }

  /**
   * Одобрение заявки менеджером: заявка → APPROVED и создаётся машина (шаг 1, без VIN, клиент
   * заявки) со ссылкой Request.vehicleId — всё в одной транзакции. Идемпотентно: у заявки,
   * к которой машина уже привязана, повторный вызов возвращает ту же машину и ничего не создаёт.
   */
  async approve(admin: AuthUser, id: string): Promise<ApproveRequestResultDto> {
    const vehicleId = await this.prisma.$transaction(async (tx) => {
      // Блокировка строки: сериализует параллельные approve и запись сообщений (см. MessagesService)
      const [locked] = await tx.$queryRaw<
        { vehicleId: string | null; clientId: string; title: string }[]
      >`SELECT "vehicleId", "clientId", "title" FROM "Request"
          WHERE "id" = ${id}::uuid FOR UPDATE`;
      if (!locked) throw new NotFoundException('Request not found');
      if (locked.vehicleId) return locked.vehicleId;

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
      return vehicle.id;
    });

    return {
      request: await this.get(admin, id),
      vehicle: await this.vehicles.getCard(admin, vehicleId),
    };
  }
}

function toView(r: RequestWithClient, unreadCount: number): RequestViewDto {
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
    createdAt: r.createdAt,
  };
}
