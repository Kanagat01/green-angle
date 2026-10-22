// Service worker: показывает push-уведомления о сообщениях в диалоге и открывает диалог по клику.
self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { body: event.data ? event.data.text() : "" };
  }
  event.waitUntil(
    self.registration.showNotification(data.title || "HUATECH", {
      body: data.body || "",
      tag: data.tag,
      data: { url: data.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const raw = event.notification.data && event.notification.data.url;
  event.waitUntil(
    (async () => {
      // Открываем только страницы этого же сайта
      let url = null;
      try {
        const parsed = new URL(raw, self.location.origin);
        if (parsed.origin === self.location.origin) url = parsed.href;
      } catch {
        url = null;
      }
      const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (url) {
        const same = windows.find((w) => w.url === url);
        if (same) return same.focus();
        const any = windows[0];
        if (any && "navigate" in any) {
          const moved = await any.navigate(url);
          return (moved || any).focus();
        }
        return self.clients.openWindow(url);
      }
      if (windows[0]) return windows[0].focus();
    })(),
  );
});
