import { Role } from '../generated/prisma/client.js';

/** Данные пользователя, извлечённые из access-токена и положенные в request.user. */
export interface AuthUser {
  id: string;
  role: Role;
  /** null только у ADMIN */
  clientId: string | null;
}

export interface AccessTokenPayload {
  sub: string;
  role: Role;
  clientId: string | null;
}

export interface RefreshTokenPayload {
  sub: string;
  /** id записи RefreshToken */
  jti: string;
}
