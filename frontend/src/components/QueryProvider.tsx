"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, useState, type ReactNode } from "react";
import { ApiError, setSessionExpiredHandler } from "@/lib/api/client";
import { endSession } from "@/lib/session";
import { toast } from "@/lib/store";

/** Ошибки 4xx повторять бессмысленно (нет доступа, не найдено, неверные данные); сбои сети и 5xx — до двух раз. */
function shouldRetry(count: number, error: unknown): boolean {
  if (error instanceof ApiError && error.status >= 400 && error.status < 500) return false;
  return count < 2;
}

export function QueryProvider({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 15_000, retry: shouldRetry, refetchOnWindowFocus: true },
          mutations: { retry: false },
        },
      }),
  );

  useEffect(() => {
    setSessionExpiredHandler(() => {
      endSession(client);
      toast("Сессия закончилась. Войдите снова.");
    });
    return () => setSessionExpiredHandler(undefined);
  }, [client]);

  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
