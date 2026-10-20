import { KIND } from "./constants";
import type { Car, Request } from "./types";

const pad = (n: number) => String(n).padStart(2, "0");

export function now(): string {
  const d = new Date();
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}, ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function today(): string {
  const d = new Date();
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()}`;
}

export function money(v: string): string {
  const n = parseInt(String(v).replace(/\D/g, ""), 10);
  return isNaN(n) ? String(v) : `${n.toLocaleString("ru-RU").replace(/ /g, " ")} ₽`;
}

export function reqTitle(r: Request): string {
  return `${r.model}, ${r.year}`;
}

export function isWaiting(r: Request): boolean {
  if (r.status === "approved" || r.status === "rejected") return false;
  const m = r.messages[r.messages.length - 1];
  return !m || m.who === "client";
}

export function carTone(c: Car): "success" | "warning" | "accent" {
  if (c.step === 13) return "success";
  const k = KIND[c.step - 1];
  const f = (c.files[c.step] || []).length;
  return k !== "none" && !f ? "warning" : "accent";
}

export function ownerKindLabel(type: "picker" | "person"): string {
  return type === "picker" ? "Компания по привозу" : "Физ.лицо";
}
