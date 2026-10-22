"use client";

import { useEffect, useState } from "react";

/** Значение с задержкой: поиск уходит на сервер, когда человек перестал печатать. */
export function useDebounced<T>(value: T, ms = 250): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}
