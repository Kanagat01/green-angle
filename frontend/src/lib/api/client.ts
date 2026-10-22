import { clearTokens, readTokens, writeTokens, type Tokens } from "./tokens";
import type { components } from "./schema";

export type Schemas = components["schemas"];

export const API_URL = (process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/api/v1").replace(/\/+$/, "");

/** Ошибка ответа API: `code` есть не у всех (EMAIL_NOT_VERIFIED, INVALID_TOKEN, …), `message` — для показа пользователю. */
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code?: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

type Options = {
  method?: "GET" | "POST" | "PATCH" | "PUT" | "DELETE";
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  /** Без заголовка авторизации и без обновления токена (вход, регистрация, подтверждение) */
  anonymous?: boolean;
};

let onSessionExpired: (() => void) | undefined;

/** Вызывается, когда обновить токен не удалось и сессия закончилась. */
export function setSessionExpiredHandler(handler: (() => void) | undefined): void {
  onSessionExpired = handler;
}

let refreshing: Promise<Tokens | null> | undefined;

/**
 * Один запрос на обновление на всех: refresh-токен одноразовый (ротация), параллельные вызовы
 * отозвали бы друг у друга пару. Если другая вкладка успела обновить токены, берём её пару.
 */
async function doRefresh(failed: Tokens): Promise<Tokens | null> {
  try {
    const current = readTokens();
    if (current && current.refreshToken !== failed.refreshToken) return current;
    const res = await fetch(`${API_URL}/auth/refresh`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ refreshToken: failed.refreshToken }),
    });
    if (res.ok) {
      const pair = (await res.json()) as Schemas["TokenPairDto"];
      const tokens = { accessToken: pair.accessToken, refreshToken: pair.refreshToken };
      writeTokens(tokens);
      return tokens;
    }
    if (res.status === 401 || res.status === 403 || res.status === 400) {
      const latest = readTokens();
      if (latest && latest.refreshToken !== failed.refreshToken) return latest;
      clearTokens();
      onSessionExpired?.();
    }
    return null;
  } catch {
    // сети нет — сессию не сбрасываем, запрос просто завершится ошибкой
    return null;
  }
}

function refreshTokens(failed: Tokens): Promise<Tokens | null> {
  if (!refreshing) {
    const attempt = doRefresh(failed);
    refreshing = attempt;
    void attempt.finally(() => {
      refreshing = undefined;
    });
  }
  return refreshing;
}

function buildUrl(path: string, query: Options["query"]): string {
  const url = `${API_URL}${path}`;
  if (!query) return url;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined && value !== null && value !== "") params.set(key, String(value));
  }
  const qs = params.toString();
  return qs ? `${url}?${qs}` : url;
}

async function toError(res: Response): Promise<ApiError> {
  let message = res.statusText || `HTTP ${res.status}`;
  let code: string | undefined;
  try {
    const data = (await res.json()) as { message?: string | string[]; code?: string };
    if (Array.isArray(data.message)) message = data.message.join("; ");
    else if (typeof data.message === "string") message = data.message;
    code = data.code;
  } catch {
    // тело не JSON — остаётся статус
  }
  return new ApiError(res.status, message, code);
}

function send(path: string, opts: Options, tokens: Tokens | null): Promise<Response> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["Content-Type"] = "application/json";
  if (tokens && !opts.anonymous) headers.Authorization = `Bearer ${tokens.accessToken}`;
  return fetch(buildUrl(path, opts.query), {
    method: opts.method ?? "GET",
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
}

/** Запрос к API с авторизацией; при 401 один раз обновляет токены и повторяет запрос. */
export async function api<T = void>(path: string, opts: Options = {}): Promise<T> {
  const tokens = opts.anonymous ? null : readTokens();
  let res: Response;
  try {
    res = await send(path, opts, tokens);
  } catch {
    throw new ApiError(0, "Нет связи с сервером. Проверьте интернет и попробуйте снова");
  }

  if (res.status === 401 && tokens && !opts.anonymous) {
    const fresh = await refreshTokens(tokens);
    if (fresh) {
      try {
        res = await send(path, opts, fresh);
      } catch {
        throw new ApiError(0, "Нет связи с сервером. Проверьте интернет и попробуйте снова");
      }
    }
  }

  if (!res.ok) throw await toError(res);
  if (res.status === 204) return undefined as T;
  const text = await res.text();
  return (text ? JSON.parse(text) : undefined) as T;
}

/** Ссылки на файлы могут быть относительными к адресу API (драйвер disk без FILES_PUBLIC_URL). */
export function resolveApiUrl(url: string): string {
  return /^https?:\/\//.test(url) ? url : new URL(url, API_URL).toString();
}
