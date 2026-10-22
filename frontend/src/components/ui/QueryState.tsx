"use client";

import { ApiError } from "@/lib/api/client";
import { NotFoundCard } from "./NotFoundCard";

/** Пока данные грузятся: тот же вид карточки, что у пустых списков. */
export function Loading() {
  return (
    <div className="card empty" role="status">
      <span className="sub muted">Загружаем…</span>
    </div>
  );
}

/** Ошибка загрузки: 404 и 403 — «нет такого раздела» (чужие записи не раскрываются), остальное — с кнопкой повтора. */
export function LoadError({ error, retry }: { error: unknown; retry: () => void }) {
  if (error instanceof ApiError && (error.status === 404 || error.status === 403)) return <NotFoundCard />;
  return (
    <div className="card empty" role="alert">
      <span className="headline">Не удалось загрузить</span>
      <span className="sub muted">{error instanceof ApiError ? error.message : "Что-то пошло не так."}</span>
      <button type="button" className="btn btn-tinted" onClick={retry}>
        Повторить
      </button>
    </div>
  );
}
