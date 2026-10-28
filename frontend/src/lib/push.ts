"use client";

import { useQuery } from "@tanstack/react-query";
import { useCallback, useEffect, useState } from "react";
import { ApiError, api, type Schemas } from "./api/client";
import { toast } from "./store";

export type PushState = "checking" | "unsupported" | "unavailable" | "denied" | "off" | "on" | "busy";

const supported = () =>
  typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;

/** Публичный ключ VAPID приходит в base64url, а браузеру нужны байты */
function keyBytes(base64url: string): Uint8Array<ArrayBuffer> {
  const padded = (base64url + "=".repeat((4 - (base64url.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  const bytes = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) bytes[i] = raw.charCodeAt(i);
  return bytes;
}

async function currentSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.getRegistration("/sw.js");
  return reg ? reg.pushManager.getSubscription() : null;
}

/** При выходе устройство перестаёт получать уведомления прежнего пользователя. Сбои не мешают выйти. */
export async function dropPushSubscription(): Promise<void> {
  if (!supported()) return;
  try {
    const sub = await currentSubscription();
    if (!sub) return;
    await api("/me/push-subscriptions", { method: "DELETE", body: { endpoint: sub.endpoint } }).catch(() => undefined);
    await sub.unsubscribe();
  } catch {
    // нечего делать: подписка останется, сервер сам удалит её, когда браузер её отзовёт
  }
}

/** Push-уведомления этого браузера: включить, выключить и в каком состоянии. */
export function usePush() {
  const config = useQuery({
    queryKey: ["push-config"],
    queryFn: () => api<Schemas["PushConfigDto"]>("/me/push/public-key"),
    staleTime: Infinity,
    enabled: supported(),
  });
  const [local, setState] = useState<Exclude<PushState, "unsupported" | "unavailable">>("checking");
  const state: PushState = !supported() ? "unsupported" : config.data && !config.data.enabled ? "unavailable" : local;

  const refresh = useCallback(async () => {
    if (Notification.permission === "denied") return setState("denied");
    setState((await currentSubscription()) ? "on" : "off");
  }, []);

  const serverReady = Boolean(config.data?.enabled);
  useEffect(() => {
    if (!serverReady) return;
    let cancelled = false;
    void (async () => {
      const next = Notification.permission === "denied" ? "denied" : (await currentSubscription()) ? "on" : "off";
      if (!cancelled) setState(next);
    })();
    return () => {
      cancelled = true;
    };
  }, [serverReady]);

  const enable = async () => {
    const publicKey = config.data?.publicKey;
    if (!publicKey) return;
    setState("busy");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setState(permission === "denied" ? "denied" : "off");
        if (permission === "denied") {
          // Браузер помнит запрет и повторно не спрашивает: разрешить можно только вручную
          toast("Браузер заблокировал уведомления для этого сайта. Нажмите на значок замка слева от адреса, у пункта «Уведомления» выберите «Разрешить» и повторите.", 10_000);
        }
        return;
      }
      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(publicKey) });
      const json = sub.toJSON();
      await api("/me/push-subscriptions", {
        method: "POST",
        body: { endpoint: sub.endpoint, keys: { p256dh: json.keys?.p256dh, auth: json.keys?.auth } },
      });
      toast("Уведомления включены. Они приходят о новых сообщениях в диалогах.");
      setState("on");
    } catch (err) {
      toast(err instanceof ApiError ? err.message : "Не удалось включить уведомления в этом браузере.");
      await refresh();
    }
  };

  const disable = async () => {
    setState("busy");
    try {
      await dropPushSubscription();
      toast("Уведомления выключены.");
    } finally {
      await refresh();
    }
  };

  return { state, enable, disable };
}
