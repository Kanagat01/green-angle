import { Injectable, Logger } from '@nestjs/common';
import type { Server } from 'socket.io';
import {
  MessageCreatedPayload,
  RealtimeEvents,
  RequestUpdatedPayload,
  rooms,
  VehicleDeletedPayload,
  VehicleStatusChangedPayload,
} from './realtime.events.js';

/**
 * Публикация событий из бизнес-сервисов. Сервер Socket.IO подключается шлюзом при старте;
 * пока его нет (или при сбое отправки) события молча пропускаются — HTTP-запрос от этого
 * не должен страдать.
 */
@Injectable()
export class RealtimeService {
  private readonly logger = new Logger(RealtimeService.name);
  private server?: Server;

  attach(server: Server) {
    this.server = server;
  }

  messageCreated(payload: MessageCreatedPayload) {
    this.emit(
      [rooms.request(payload.message.requestId)],
      RealtimeEvents.MESSAGE_CREATED,
      payload,
    );
  }

  requestUpdated(payload: RequestUpdatedPayload) {
    this.emit(
      [rooms.client(payload.clientId), rooms.admins],
      RealtimeEvents.REQUEST_UPDATED,
      payload,
    );
  }

  vehicleStatusChanged(payload: VehicleStatusChangedPayload) {
    this.emit(
      [rooms.client(payload.clientId), rooms.admins],
      RealtimeEvents.VEHICLE_STATUS_CHANGED,
      payload,
    );
  }

  vehicleDeleted(payload: VehicleDeletedPayload) {
    this.emit(
      [rooms.client(payload.clientId), rooms.admins],
      RealtimeEvents.VEHICLE_DELETED,
      payload,
    );
  }

  /** Закрывает все сокеты пользователя (деактивация, сброс пароля, удаление). */
  disconnectUser(userId: string) {
    try {
      this.server?.in(rooms.user(userId)).disconnectSockets(true);
    } catch (err) {
      this.logger.warn(
        `Failed to disconnect user ${userId}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private emit(targets: string[], event: string, payload: unknown) {
    try {
      // Несколько комнат в одном вызове: сокет в нескольких из них получит событие один раз
      this.server?.to(targets).emit(event, payload);
    } catch (err) {
      this.logger.warn(
        `Failed to emit "${event}": ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }
}
