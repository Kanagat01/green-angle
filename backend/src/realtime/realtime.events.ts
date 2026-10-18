import type { MessageViewDto } from '../messages/dto/message-views.dto.js';
import type { RequestStatus } from '../generated/prisma/client.js';

/** События Socket.IO (PLAN.md §6) и команды клиента. */
export const RealtimeEvents = {
  /** Новое сообщение в диалоге — только подписчикам комнаты заявки (`request.join`) */
  MESSAGE_CREATED: 'message.created',
  /** Заявка создана / в ней новое сообщение / сменился статус / одобрена — клиенту и менеджерам */
  REQUEST_UPDATED: 'request.updated',
  /** Машина создана или сменила статус — клиенту-владельцу и менеджерам */
  VEHICLE_STATUS_CHANGED: 'vehicle.status_changed',
} as const;

export const RealtimeCommands = {
  JOIN_REQUEST: 'request.join',
  LEAVE_REQUEST: 'request.leave',
} as const;

/** Комнаты: клиент и менеджеры подключаются автоматически, комната заявки — по запросу. */
export const rooms = {
  admins: 'admins',
  user: (userId: string) => `user:${userId}`,
  client: (clientId: string) => `client:${clientId}`,
  request: (requestId: string) => `request:${requestId}`,
} as const;

/** Сообщение одинаково для всех получателей, поэтому без `isMine` (сравнивайте author.id со своим). */
export type SharedMessage = Omit<MessageViewDto, 'isMine'>;

export interface MessageCreatedPayload {
  message: SharedMessage;
}

export type RequestUpdateReason = 'CREATED' | 'MESSAGE' | 'APPROVED';

export interface RequestUpdatedPayload {
  requestId: string;
  clientId: string;
  status: RequestStatus;
  vehicleId: string | null;
  reason: RequestUpdateReason;
  at: string;
}

export interface VehicleStatusChangedPayload {
  vehicleId: string;
  clientId: string;
  /** null — машина только что создана */
  fromStep: number | null;
  toStep: number;
  toStepTitle: string;
  declarationNumber: string | null;
  at: string;
}

export type JoinResult =
  { ok: true } | { ok: false; error: 'BAD_REQUEST' | 'NOT_FOUND' };
