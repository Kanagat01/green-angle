import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  ClientDetailDto,
  ClientListDto,
  ClientListItemDto,
} from './dto/client-views.dto.js';
import { CreateClientDto } from './dto/create-client.dto.js';
import { ListClientsQueryDto } from './dto/list-clients-query.dto.js';
import { UpdateClientDto } from './dto/update-client.dto.js';

const countInclude = {
  _count: {
    select: {
      users: true,
      vehicles: { where: { deletedAt: null } },
      requests: true,
    },
  },
} satisfies Prisma.ClientInclude;

const detailInclude = {
  ...countInclude,
  users: {
    orderBy: { createdAt: 'asc' },
    select: { id: true, email: true, role: true, isActive: true },
  },
} satisfies Prisma.ClientInclude;

type ClientWithCounts = Prisma.ClientGetPayload<{
  include: typeof countInclude;
}>;

@Injectable()
export class ClientsService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListClientsQueryDto): Promise<ClientListDto> {
    const where: Prisma.ClientWhereInput = {
      ...(query.type ? { type: query.type } : {}),
      ...(query.search
        ? { name: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.client.findMany({
        where,
        include: countInclude,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.client.count({ where }),
    ]);
    return { items: items.map(toListItem), total };
  }

  async get(id: string): Promise<ClientDetailDto> {
    const client = await this.prisma.client.findUnique({
      where: { id },
      include: detailInclude,
    });
    if (!client) throw new NotFoundException('Client not found');
    return { ...toListItem(client), users: client.users };
  }

  async create(dto: CreateClientDto): Promise<ClientDetailDto> {
    const created = await this.prisma.client.create({
      data: { type: dto.type, name: dto.name },
      select: { id: true },
    });
    return this.get(created.id);
  }

  async update(id: string, dto: UpdateClientDto): Promise<ClientDetailDto> {
    const current = await this.get(id);
    if (
      dto.type !== undefined &&
      dto.type !== current.type &&
      current.usersCount > 0
    ) {
      // Роли пользователей (BROKER / INDIVIDUAL) привязаны к типу клиента
      throw new ConflictException(
        'Client type cannot be changed while the client has users',
      );
    }
    const data: Prisma.ClientUpdateInput = {};
    if (dto.name !== undefined) data.name = dto.name;
    if (dto.type !== undefined) data.type = dto.type;
    if (Object.keys(data).length > 0) {
      await this.prisma.client.update({ where: { id }, data });
    }
    return this.get(id);
  }

  /**
   * Удаление только пустого клиента: с пользователями, машинами или заявками — 409
   * (деактивируйте пользователей, историю не стираем).
   */
  async remove(id: string): Promise<void> {
    const client = await this.get(id);
    if (client.usersCount + client.vehiclesCount + client.requestsCount > 0) {
      throw new ConflictException(
        'Client has users, vehicles or requests and cannot be deleted',
      );
    }
    try {
      await this.prisma.client.delete({ where: { id } });
    } catch (err) {
      // Запись могла появиться между проверкой и удалением — внешний ключ не даст удалить
      if ((err as { code?: string } | null)?.code === 'P2003') {
        throw new ConflictException(
          'Client has users, vehicles or requests and cannot be deleted',
        );
      }
      throw err;
    }
  }
}

function toListItem(c: ClientWithCounts): ClientListItemDto {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    usersCount: c._count.users,
    vehiclesCount: c._count.vehicles,
    requestsCount: c._count.requests,
    createdAt: c.createdAt,
  };
}
