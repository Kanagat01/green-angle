"use client";

import { useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { startRealtime } from "@/lib/realtime";

/** Держит соединение с сервером, пока человек в кабинете. */
export function Realtime() {
  const client = useQueryClient();
  useEffect(() => startRealtime(client), [client]);
  return null;
}
