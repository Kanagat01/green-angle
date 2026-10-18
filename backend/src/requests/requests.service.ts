import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { AuthUser } from '../auth/auth-user.js';
import { clientScope } from '../common/scope.js';
import type { Prisma, RequestStatus } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateRequestDto } from './dto/create-request.dto.js';
import { RequestListDto, RequestViewDto } from './dto/request-views.dto.js';

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
  constructor(private readonly prisma: PrismaService) {}

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
    return toView(created);
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
    return { items: items.map(toView), total };
  }

  async get(user: AuthUser, id: string): Promise<RequestViewDto> {
    const request = await this.prisma.request.findFirst({
      where: { id, ...clientScope(user) },
      include,
    });
    // 404, а не 403: не раскрываем существование чужих заявок
    if (!request) throw new NotFoundException('Request not found');
    return toView(request);
  }
}

function toView(r: RequestWithClient): RequestViewDto {
  return {
    id: r.id,
    title: r.title,
    yearFrom: r.yearFrom,
    budget: r.budget === null ? null : r.budget.toNumber(),
    comment: r.comment,
    status: r.status,
    vehicleId: r.vehicleId,
    client: r.client,
    createdAt: r.createdAt,
  };
}
