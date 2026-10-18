import { SetMetadata } from '@nestjs/common';
import { Role } from '../../generated/prisma/client.js';

export const ROLES_KEY = 'roles';

/** Ограничивает маршрут перечисленными ролями. Без декоратора доступен любой авторизованный. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);
