"use client";

import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { api, type Schemas } from "./api/client";
import { clearTokens, readTokens, writeTokens } from "./api/tokens";
import { bumpAuth, useApp } from "./store";
import type { Role } from "./types";

export type Me = Schemas["MeDto"];

export const ME_KEY = ["me"] as const;

const ROLES: Record<Me["role"], Role> = { ADMIN: "super", BROKER: "picker", INDIVIDUAL: "person" };

export const roleOf = (me: Me): Role => ROLES[me.role];

export type Session =
  | { status: "loading" }
  | { status: "anon" }
  | { status: "error"; retry: () => void }
  | { status: "authed"; me: Me; role: Role };

/**
 * Текущая сессия. До гидратации — loading (экран совпадает с серверным HTML), без токенов — anon,
 * иначе профиль берётся с сервера: роль и клиента определяет он, а не браузер.
 */
export function useSession(): Session {
  const { ready } = useApp();
  const hasTokens = ready && readTokens() !== null;
  const query = useQuery({ queryKey: ME_KEY, queryFn: () => api<Me>("/me"), enabled: hasTokens, staleTime: 60_000 });

  if (!ready) return { status: "loading" };
  if (!hasTokens) return { status: "anon" };
  if (query.data) return { status: "authed", me: query.data, role: roleOf(query.data) };
  if (query.isError) return { status: "error", retry: () => void query.refetch() };
  return { status: "loading" };
}

/** Роль вошедшего пользователя; для гостя null. */
export function useRole(): Role | null {
  const s = useSession();
  return s.status === "authed" ? s.role : null;
}

/** Вход: токены, затем профиль. Ошибки API (неверный пароль, почта не подтверждена) пробрасываются как есть. */
export function useLogin() {
  const client = useQueryClient();
  return async (email: string, password: string): Promise<Me> => {
    const pair = await api<Schemas["TokenPairDto"]>("/auth/login", {
      method: "POST",
      body: { email, password },
      anonymous: true,
    });
    writeTokens({ accessToken: pair.accessToken, refreshToken: pair.refreshToken });
    try {
      const me = await api<Me>("/me");
      client.setQueryData(ME_KEY, me);
      bumpAuth();
      return me;
    } catch (err) {
      clearTokens();
      throw err;
    }
  };
}

/** Письма физлицу о смене статуса его машин: включить или выключить. */
export function useSetEmailNotifications() {
  const client = useQueryClient();
  return useMutation({
    mutationFn: (emailNotifications: boolean) =>
      api<Me>("/me", { method: "PATCH", body: { emailNotifications } }),
    onSuccess: (me) => client.setQueryData(ME_KEY, me),
  });
}

/** Закрывает сессию в браузере: токены, кэш данных, подписки интерфейса. */
export function endSession(client: QueryClient): void {
  clearTokens();
  client.clear();
  bumpAuth();
}

export function useLogout() {
  const client = useQueryClient();
  return async () => {
    const tokens = readTokens();
    if (tokens) {
      // Сервер отзывает refresh-токен; если связи нет, из браузера всё равно выходим
      await api("/auth/logout", { method: "POST", body: { refreshToken: tokens.refreshToken }, anonymous: true }).catch(() => undefined);
    }
    endSession(client);
  };
}
