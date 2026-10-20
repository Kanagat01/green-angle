"use client";

import { useGo } from "@/lib/nav";
import { isClient, useApp } from "@/lib/store";

export function NotFoundCard() {
  const { role } = useApp();
  const go = useGo();
  return (
    <div className="card empty">
      <span className="headline">Этого раздела нет в текущем кабинете</span>
      <button type="button" className="btn btn-tinted" onClick={() => go(isClient(role) ? "cars" : "scars")}>
        На главную
      </button>
    </div>
  );
}
