"use client";

import { useGo } from "@/lib/nav";
import { useRole } from "@/lib/session";

export function NotFoundCard() {
  const role = useRole();
  const go = useGo();
  return (
    <div className="card empty">
      <span className="headline">Этого раздела нет в текущем кабинете</span>
      <button type="button" className="btn btn-tinted" onClick={() => go(role === "super" ? "scars" : "cars")}>
        На главную
      </button>
    </div>
  );
}
