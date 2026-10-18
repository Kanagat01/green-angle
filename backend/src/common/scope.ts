import { ForbiddenException } from '@nestjs/common';
import { Role } from '../generated/prisma/client.js';
import { AuthUser } from '../auth/auth-user.js';

/**
 * Единая точка изоляции данных (PLAN.md §3): ADMIN видит всё, BROKER/INDIVIDUAL — только
 * записи со своим clientId. Результат подмешивается в `where` любого запроса к сущностям,
 * у которых есть clientId (Vehicle, Request).
 */
export function clientScope(user: AuthUser): { clientId?: string } {
  if (user.role === Role.ADMIN) return {};
  if (!user.clientId)
    throw new ForbiddenException('User is not attached to a client');
  return { clientId: user.clientId };
}

/** Проверка доступа к конкретному клиенту (например, при создании заявки). */
export function assertClientAccess(user: AuthUser, clientId: string): void {
  if (user.role === Role.ADMIN) return;
  if (!user.clientId || user.clientId !== clientId)
    throw new ForbiddenException();
}
