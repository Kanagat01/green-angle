"use client";

import type { QueryClient } from "@tanstack/react-query";
import { io, type Socket } from "socket.io-client";
import { API_URL, api } from "./api/client";
import { readTokens } from "./api/tokens";
import { invalidateRequest, invalidateVehicle } from "./api/queries";

type RequestUpdated = { requestId: string };
type VehicleChanged = { vehicleId: string };
type MessageCreated = { message: { requestId: string } };

let socket: Socket | null = null;
/** Комнаты заявок, открытых на экране: число подписчиков (диалог может быть открыт один раз, но эффект перезапускается) */
const joined = new Map<string, number>();

const origin = () => new URL(API_URL).origin;

let activeClient: QueryClient | null = null;

/** Вход в комнату заявки. Всё, что написали до входа, событием не придёт, поэтому после входа перечитываем диалог. */
function join(s: Socket, requestId: string) {
  s.emit("request.join", { requestId }, (res: { ok: boolean } | undefined) => {
    if (res?.ok && activeClient) invalidateRequest(activeClient, requestId);
  });
}

/**
 * Живые обновления: сервер присылает события, а мы лишь помечаем нужные данные устаревшими —
 * экран сам перечитает их из API, поэтому правда всегда одна (сервер).
 * Возвращает функцию остановки.
 */
export function startRealtime(client: QueryClient): () => void {
  stopRealtime();
  activeClient = client;
  const s = io(origin(), {
    // Токен читается заново при каждом подключении, поэтому после обновления он свежий
    auth: (cb) => cb({ token: readTokens()?.accessToken ?? "" }),
    transports: ["websocket"],
    reconnectionDelayMax: 10_000,
  });
  socket = s;
  let retry: ReturnType<typeof setTimeout> | undefined;

  s.on("connect", () => {
    for (const requestId of joined.keys()) join(s, requestId);
    // Пока связи не было (или соединение только устанавливалось), события могли пропасть: перечитываем всё
    void client.invalidateQueries();
  });

  // Сервер закрывает соединение, когда истекает access-токен, а при неверном токене отказывает:
  // обновляем токен обычным запросом и подключаемся снова
  const reconnectLater = () => {
    clearTimeout(retry);
    retry = setTimeout(() => {
      void api("/me")
        .catch(() => undefined)
        .finally(() => {
          if (socket === s && readTokens()) s.connect();
        });
    }, 1000);
  };
  s.on("disconnect", (reason) => {
    if (reason === "io server disconnect") reconnectLater();
  });
  s.on("connect_error", (err) => {
    if (err.message === "unauthorized") reconnectLater();
  });

  s.on("request.updated", (e: RequestUpdated) => invalidateRequest(client, e.requestId));
  s.on("message.created", (e: MessageCreated) => invalidateRequest(client, e.message.requestId));
  s.on("vehicle.status_changed", (e: VehicleChanged) => invalidateVehicle(client, e.vehicleId));
  // Удалённая машина пропадает из списков, а заявка теряет на неё ссылку
  s.on("vehicle.deleted", (e: VehicleChanged) => {
    invalidateVehicle(client, e.vehicleId);
    void client.invalidateQueries({ queryKey: ["requests"] });
    void client.invalidateQueries({ queryKey: ["request"] });
  });

  return () => {
    clearTimeout(retry);
    if (socket === s) stopRealtime();
  };
}

export function stopRealtime(): void {
  socket?.disconnect();
  socket = null;
  activeClient = null;
}

/** Подписка на сообщения заявки, пока открыт её диалог. */
export function joinRequestRoom(requestId: string): () => void {
  joined.set(requestId, (joined.get(requestId) ?? 0) + 1);
  if (socket?.connected) join(socket, requestId);
  return () => {
    const left = (joined.get(requestId) ?? 1) - 1;
    if (left > 0) {
      joined.set(requestId, left);
      return;
    }
    joined.delete(requestId);
    if (socket?.connected) socket.emit("request.leave", { requestId });
  };
}
