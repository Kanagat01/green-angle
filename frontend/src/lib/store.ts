"use client";

import { useSyncExternalStore } from "react";
import { FULL, OWNERS } from "./constants";
import { isWaiting, now, reqTitle, today } from "./format";
import { seed } from "./seed";
import type { Attachment, Car, Db, Owner, Request, Role } from "./types";

const KEY = "ga-proto-v2";

export type CarFilter = "all" | "active" | "ready";
export type OwnerFilter = "all" | "picker" | "person";
export type ReqFilter = "waiting" | "all";

export type EditState = { carId: string | null; target: number; uploads: string[]; nonce: number };

export type ModalState =
  | { kind: "login"; staff: boolean }
  | { kind: "register"; type: "picker" | "person" }
  | { kind: "newReq" }
  | { kind: "addCar" }
  | { kind: "delCar"; carId: string };

export type AppState = {
  db: Db;
  role: Role;
  authed: boolean;
  /** localStorage уже прочитан (до этого момента экран совпадает с серверным HTML) */
  ready: boolean;
  carQ: string;
  carFilter: CarFilter;
  ownerFilter: OwnerFilter;
  vinQ: string;
  reqFilter: ReqFilter;
  pending: Attachment[];
  edit: EditState;
  lp: { step: number; vin: string; checked: boolean };
  modal: ModalState | null;
  toast: { text: string; id: number } | null;
};

const initial: AppState = {
  db: seed(),
  role: "picker",
  authed: false,
  ready: false,
  carQ: "",
  carFilter: "all",
  ownerFilter: "all",
  vinQ: "",
  reqFilter: "waiting",
  pending: [],
  edit: { carId: null, target: 0, uploads: [], nonce: 0 },
  lp: { step: 9, vin: "", checked: false },
  modal: null,
  toast: null,
};

let state: AppState = initial;
const listeners = new Set<() => void>();

function set(patch: Partial<AppState>) {
  state = { ...state, ...patch };
  listeners.forEach((l) => l());
}

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify({ db: state.db, role: state.role, authed: state.authed }));
  } catch {}
}

export function useApp(): AppState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    () => state,
    () => initial,
  );
}

export const getState = () => state;

export function hydrate() {
  if (state.ready) return;
  const patch: Partial<AppState> = { ready: true };
  try {
    const s = localStorage.getItem(KEY);
    if (s) {
      const o = JSON.parse(s);
      if (o && o.db) {
        patch.db = o.db;
        if (o.role) patch.role = o.role;
        patch.authed = !!o.authed;
      }
    }
  } catch {}
  set(patch);
}

/* ---------- выборки ---------- */

export const isClient = (role: Role) => role !== "super";

export function sameOwner(role: Role, o: Owner): boolean {
  if (role === "super") return false;
  const m = OWNERS[role];
  return o.type === m.type && o.name === m.name;
}

export const myCars = (s: AppState) => s.db.cars.filter((c) => sameOwner(s.role, c.owner));
export const myReqs = (s: AppState) => s.db.requests.filter((r) => sameOwner(s.role, r.owner));
export const carById = (db: Db, id: string | null | undefined) => db.cars.find((c) => c.id === id);
export const reqById = (db: Db, id: string | null | undefined) => db.requests.find((r) => r.id === id);

/* ---------- изменения ---------- */

function mutate<T>(fn: (db: Db) => T): T {
  const db = structuredClone(state.db);
  const res = fn(db);
  set({ db });
  persist();
  return res;
}

function nid(db: Db, p: string) {
  db.seq++;
  return p + db.seq;
}

export function setRole(role: Role) {
  set({ role });
  persist();
}

export function enter(role: Role) {
  set({ authed: true, role });
  persist();
}

export function logout() {
  set({ authed: false });
  persist();
}

export function resetDemo() {
  set({
    db: seed(),
    pending: [],
    edit: { carId: null, target: 0, uploads: [], nonce: state.edit.nonce + 1 },
    carQ: "",
    vinQ: "",
  });
  persist();
}

export const setUi = (patch: Partial<AppState>) => set(patch);

/** Элемент, с которого открыли окно: после закрытия фокус возвращается ему, если он ещё в документе. */
let lastFocus: Element | null = null;

export function openModal(modal: ModalState) {
  lastFocus = document.activeElement;
  set({ modal });
}

export function closeModal() {
  if (state.modal) set({ modal: null });
}

export function restoreModalFocus() {
  if (lastFocus instanceof HTMLElement && document.body.contains(lastFocus)) lastFocus.focus();
  lastFocus = null;
}

let toastTimer: ReturnType<typeof setTimeout> | undefined;
let toastSeq = 0;
export function toast(text: string) {
  const id = ++toastSeq;
  set({ toast: { text, id } });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    if (state.toast && state.toast.id === id) set({ toast: null });
  }, 3200);
}

export function createRequest(input: { model: string; year: string; budget: string; comment: string }): string {
  const owner = OWNERS[state.role as "picker" | "person"];
  return mutate((db) => {
    const id = nid(db, "r");
    const r: Request = {
      id,
      seqn: db.seq,
      model: input.model,
      year: input.year,
      budget: input.budget,
      comment: input.comment,
      owner,
      status: "new",
      created: today(),
      messages: [],
    };
    r.messages.push({
      who: "client",
      time: now(),
      text:
        "Новая заявка: " + input.model + ", " + r.year + ". Бюджет " + r.budget + "." +
        (r.comment ? "\n" + r.comment : ""),
      files: [],
    });
    db.requests.push(r);
    return id;
  });
}

export function sendMessage(reqId: string, text: string, manager: boolean) {
  const files = state.pending.slice();
  mutate((db) => {
    const r = reqById(db, reqId)!;
    r.messages.push({ who: manager ? "manager" : "client", time: now(), text, files });
    if (manager && r.status === "new") r.status = "dialog";
  });
  set({ pending: [] });
}

export function addPending(manager: boolean) {
  const n = state.pending.length;
  const f: Attachment = manager
    ? n % 2
      ? ["link", "Ссылка на объявление"]
      : ["photo", "Вариант · фото · " + (3 + n)]
    : ["photo", "Фото_" + (n + 1) + ".jpg"];
  set({ pending: [...state.pending, f] });
}

export function removePending(i: number) {
  set({ pending: state.pending.filter((_, j) => j !== i) });
}

export function approveRequest(reqId: string) {
  mutate((db) => {
    const r = reqById(db, reqId)!;
    const c: Car = {
      id: nid(db, "c"),
      title: reqTitle(r),
      vin: "",
      owner: r.owner,
      step: 1,
      created: today(),
      updated: today().slice(0, 5),
      files: {},
      reqId: r.id,
    };
    db.cars.unshift(c);
    r.status = "approved";
    r.carId = c.id;
    r.messages.push({
      who: "system",
      time: now(),
      text: "Менеджер одобрил вариант и создал заказ. Статус: «Ожидает оплату».",
      files: [],
    });
  });
}

export function rejectRequest(reqId: string) {
  mutate((db) => {
    const r = reqById(db, reqId)!;
    r.status = "rejected";
    r.messages.push({ who: "system", time: now(), text: "Менеджер отклонил заявку.", files: [] });
  });
}

export function addCar(input: { title: string; vin: string; owner: Owner; step: number }) {
  mutate((db) => {
    db.cars.unshift({
      id: nid(db, "c"),
      title: input.title,
      vin: input.vin,
      owner: input.owner,
      step: input.step,
      created: today(),
      updated: today().slice(0, 5),
      files: {},
    });
  });
}

export function deleteCar(carId: string) {
  mutate((db) => {
    db.cars = db.cars.filter((x) => x.id !== carId);
  });
}

export function setCarVin(carId: string, vin: string) {
  mutate((db) => {
    carById(db, carId)!.vin = vin;
  });
}

export function saveCarStatus(carId: string, target: number, add: Attachment[], note: string) {
  mutate((db) => {
    const c = carById(db, carId)!;
    if (add.length) c.files[target] = (c.files[target] || []).concat(add);
    c.step = target;
    c.updated = today().slice(0, 5);
    const r = c.reqId ? reqById(db, c.reqId) : undefined;
    if (r) {
      r.messages.push({ who: "system", time: now(), text: "Статус машины: «" + FULL[target - 1] + "».", files: [] });
      if (note) r.messages.push({ who: "manager", time: now(), text: note, files: add });
    }
  });
}

export function waitingCount(db: Db) {
  return db.requests.filter(isWaiting).length;
}
