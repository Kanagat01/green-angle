import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { hash } from '@node-rs/argon2';
import { randomBytes } from 'node:crypto';
import type { AuthUser } from '../auth/auth-user.js';
import { AuthService } from '../auth/auth.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import { ClientType, Role } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { RealtimeService } from '../realtime/realtime.service.js';
import { CreateUserDto } from './dto/create-user.dto.js';
import { ListUsersQueryDto } from './dto/list-users-query.dto.js';
import { ResetPasswordDto } from './dto/reset-password.dto.js';
import { UpdateUserDto } from './dto/update-user.dto.js';
import {
  AdminUserDto,
  AdminUserListDto,
  ResetPasswordResultDto,
} from './dto/user-views.dto.js';

/** Какой тип клиента допустим для роли. */
const CLIENT_TYPE_FOR_ROLE: Partial<Record<Role, ClientType>> = {
  [Role.BROKER]: ClientType.COMPANY,
  [Role.INDIVIDUAL]: ClientType.PERSON,
};

// Явный select: passwordHash в ответы попасть не может
const select = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  clientId: true,
  createdAt: true,
  client: { select: { id: true, type: true, name: true } },
} satisfies Prisma.UserSelect;

@Injectable()
export class UsersAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auth: AuthService,
    private readonly realtime: RealtimeService,
  ) {}

  async list(query: ListUsersQueryDto): Promise<AdminUserListDto> {
    const where: Prisma.UserWhereInput = {
      ...(query.role ? { role: query.role } : {}),
      ...(query.clientId ? { clientId: query.clientId } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? { email: { contains: query.search, mode: 'insensitive' } }
        : {}),
    };
    const [items, total] = await Promise.all([
      this.prisma.user.findMany({
        where,
        select,
        orderBy: [{ createdAt: 'desc' }, { id: 'asc' }],
        take: query.limit,
        skip: query.offset,
      }),
      this.prisma.user.count({ where }),
    ]);
    return { items, total };
  }

  async get(id: string): Promise<AdminUserDto> {
    const user = await this.prisma.user.findUnique({ where: { id }, select });
    if (!user) throw new NotFoundException('User not found');
    return user;
  }

  /** Создание логина подборщику / физлицу / сотруднику. Публичной регистрации нет. */
  async create(dto: CreateUserDto): Promise<AdminUserDto> {
    await this.assertRoleMatchesClient(dto.role, dto.clientId);

    try {
      return await this.prisma.user.create({
        data: {
          email: dto.email,
          passwordHash: await hash(dto.password),
          role: dto.role,
          clientId: dto.role === Role.ADMIN ? null : dto.clientId,
        },
        select,
      });
    } catch (err) {
      throw translateDbError(err);
    }
  }

  async update(
    actor: AuthUser,
    id: string,
    dto: UpdateUserDto,
  ): Promise<AdminUserDto> {
    const data: Prisma.UserUpdateInput = {};
    if (dto.email !== undefined) data.email = dto.email;
    if (dto.isActive !== undefined) data.isActive = dto.isActive;
    if (Object.keys(data).length === 0) {
      throw new BadRequestException('Nothing to update');
    }
    if (dto.isActive === false && id === actor.id) {
      // Инвариант «всегда есть хотя бы один активный админ»: себя деактивировать нельзя
      throw new ConflictException('You cannot deactivate yourself');
    }

    let user: AdminUserDto;
    try {
      user = await this.prisma.user.update({ where: { id }, data, select });
    } catch (err) {
      throw translateDbError(err);
    }

    if (dto.isActive === false) await this.endSessions(id);
    return user;
  }

  /**
   * Сброс пароля менеджером: пароль задаётся вручную либо генерируется временный.
   * Все сессии пользователя завершаются — войти придётся с новым паролем.
   */
  async resetPassword(
    id: string,
    dto: ResetPasswordDto,
  ): Promise<ResetPasswordResultDto> {
    const generated = dto.password
      ? null
      : randomBytes(12).toString('base64url');
    const password = dto.password ?? generated!;

    try {
      await this.prisma.user.update({
        where: { id },
        data: { passwordHash: await hash(password) },
        select: { id: true },
      });
    } catch (err) {
      throw translateDbError(err);
    }
    await this.endSessions(id);
    return { temporaryPassword: generated };
  }

  /**
   * Удаление только пользователя без истории (сообщений, заявок, вложений, записей журнала).
   * Для остальных — деактивация.
   */
  async remove(actor: AuthUser, id: string): Promise<void> {
    if (id === actor.id) {
      throw new ConflictException('You cannot delete yourself');
    }
    try {
      await this.prisma.user.delete({ where: { id } });
    } catch (err) {
      throw translateDbError(err);
    }
    this.realtime.disconnectUser(id);
  }

  /** Завершает все сессии: refresh-токены отзываются, открытые сокеты закрываются. */
  private async endSessions(userId: string) {
    await this.auth.revokeAllForUser(userId);
    this.realtime.disconnectUser(userId);
  }

  private async assertRoleMatchesClient(role: Role, clientId?: string) {
    if (role === Role.ADMIN) {
      if (clientId) {
        throw new BadRequestException('ADMIN must not be attached to a client');
      }
      return;
    }

    if (!clientId) {
      throw new BadRequestException(`clientId is required for ${role}`);
    }
    const client = await this.prisma.client.findUnique({
      where: { id: clientId },
      select: { type: true },
    });
    if (!client) throw new NotFoundException('Client not found');

    const expected = CLIENT_TYPE_FOR_ROLE[role];
    if (client.type !== expected) {
      throw new BadRequestException(
        `${role} must belong to a ${expected} client, but the client is ${client.type}`,
      );
    }
  }
}

function translateDbError(err: unknown): unknown {
  const code = (err as { code?: string } | null)?.code;
  if (code === 'P2002') return new ConflictException('Email is already in use');
  if (code === 'P2025') return new NotFoundException('User not found');
  if (code === 'P2003') {
    return new ConflictException(
      'User has history (messages, requests, attachments or status changes); deactivate instead',
    );
  }
  return err;
}
