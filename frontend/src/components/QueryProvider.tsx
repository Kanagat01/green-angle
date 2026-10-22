"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { ApiError } from "@/lib/api/client";

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
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
