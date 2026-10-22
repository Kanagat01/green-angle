import type { Schemas } from "./api/client";
import type { Tone } from "./types";

type ClientType = Schemas["VehicleClientDto"]["type"];

const pad = (n: number) => String(n).padStart(2, "0");

/** «26.09, 14:05» — время сообщений */
export function dateTime(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/** «26.09.2026» */
export function dateFull(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

/** «26.09» — когда машина обновлялась */
export function dateShort(iso: string): string {
  const d = new Date(iso);
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}`;
}

export function money(v: number | null): string {
  return v === null ? "не указан" : `${Math.round(v).toLocaleString("ru-RU")} ₽`;
}

export function reqTitle(r: Pick<Schemas["RequestViewDto"], "title" | "yearFrom">): string {
  return r.yearFrom ? `${r.title}, ${r.yearFrom}` : r.title;
}

export function vehicleTone(v: Pick<Schemas["VehicleListItemDto"], "currentStep" | "awaitingAttachment">): Tone {
  if (v.currentStep === 13) return "success";
  return v.awaitingAttachment ? "warning" : "accent";
}

export function ownerKindLabel(type: ClientType): string {
  return type === "COMPANY" ? "Компания по привозу" : "Физ.лицо";
}

/** Подпись владельца в таблицах менеджера */
export function ownerKindLong(type: ClientType): string {
  return type === "COMPANY" ? "Компания по привозу · юр.лицо" : "Физ.лицо";
}
