"use client";

import { useSyncExternalStore } from "react";

export type CarFilter = "all" | "active" | "ready";
export type OwnerFilter = "all" | "COMPANY" | "PERSON";
export type ReqFilter = "waiting" | "all";

export type ModalState =
  | { kind: "login"; staff: boolean }
  | { kind: "register"; type: "COMPANY" | "PERSON" }
  | { kind: "checkMail"; email: string }
  | { kind: "newReq" }
  | { kind: "addCar" };

/** Только состояние интерфейса; данные сервера живут в кэше TanStack Query. */
export type AppState = {
  /** Клиент гидратирован (до этого экран совпадает с серверным HTML) */
  ready: boolean;
  authEpoch: number;
  carQ: string;
  carFilter: CarFilter;
  ownerFilter: OwnerFilter;
  vinQ: string;
  reqFilter: ReqFilter;
  lp: { step: number; vin: string; checked: boolean };
  modal: ModalState | null;
  toast: { text: string; id: number } | null;
};

const initial: AppState = {
  ready: false,
  authEpoch: 0,
  carQ: "",
  carFilter: "all",
  ownerFilter: "all",
  vinQ: "",
  reqFilter: "waiting",
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
  if (!state.ready) set({ ready: true });
}

export const setUi = (patch: Partial<AppState>) => set(patch);

/** Вход, выход или конец сессии: заставляет экраны заново прочитать токены. */
export function bumpAuth() {
  set({ authEpoch: state.authEpoch + 1 });
}

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
