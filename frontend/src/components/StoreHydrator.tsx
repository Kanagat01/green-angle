"use client";

import { useEffect } from "react";
import { hydrate } from "@/lib/store";

/** Читает сохранённое состояние после гидратации, чтобы первый кадр совпал с серверным HTML. */
export function StoreHydrator() {
  useEffect(() => {
    hydrate();
  }, []);
  return null;
}
