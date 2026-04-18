/// <reference lib="webworker" />
/// <reference types="vite-plugin-pwa/info" />
import { precacheAndRoute } from "workbox-precaching";
import { registerRoute } from "workbox-routing";
import { NetworkFirst, NetworkOnly } from "workbox-strategies";

declare const self: ServiceWorkerGlobalScope;

/**
 * HTML navigations: try network first so users get a fresh `index.html` after deploy.
 * (Precache-only shells are why “refresh shows new, reopen shows old”.)
 * Falls back to cache when offline / slow.
 */
registerRoute(
  ({ request }) => request.mode === "navigate",
  new NetworkFirst({
    cacheName: "cc-html",
    networkTimeoutSeconds: 4,
  })
);

precacheAndRoute(self.__WB_MANIFEST);

registerRoute(
  ({ url }) => url.pathname.startsWith("/.netlify/functions/"),
  new NetworkOnly()
);

/** Ship new SW immediately; take control of pages so updates apply without a stale tab. */
self.addEventListener("install", () => {
  void self.skipWaiting();
});
self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

type PushPayload = {
  title?: string;
  body?: string;
  url?: string;
  tag?: string;
};

/**
 * Bot sends JSON via web-push (same object shape as `event.data.json()`).
 * We read via `text()` once — PushMessageData must not be read twice.
 */
async function parsePushPayload(event: PushEvent): Promise<PushPayload> {
  const fallback: PushPayload = {
    title: "Grindset",
    body: "A new notification is available.",
  };
  if (!event.data) return fallback;
  try {
    const raw = await event.data.text();
    if (!raw?.trim()) return fallback;
    return JSON.parse(raw) as PushPayload;
  } catch {
    return fallback;
  }
}

self.addEventListener("push", (event: PushEvent) => {
  event.waitUntil(
    (async () => {
      const data = await parsePushPayload(event);
      const title = data.title ?? "Grindset";
      const body = data.body ?? "";
      const tag = data.tag ?? "grindset-event";
      const openUrl = data.url ?? "/";

      const iconUrl = new URL("/favicon.svg", self.location.origin).href;
      const badgeUrl = new URL("/favicon.svg", self.location.origin).href;

      await self.registration.showNotification(title, {
        body,
        icon: iconUrl,
        badge: badgeUrl,
        vibrate: [200, 100, 200],
        requireInteraction: true,
        tag,
        renotify: true,
        silent: false,
        data: { url: openUrl, tag },
        timestamp: Date.now(),
      });
    })()
  );
});

self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  const raw = event.notification.data as { url?: string } | undefined;
  let targetUrl = typeof raw?.url === "string" ? raw.url : "/";
  try {
    targetUrl = new URL(targetUrl, self.location.origin).href;
  } catch {
    targetUrl = new URL("/", self.location.origin).href;
  }

  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
      for (const client of clientList) {
        if (client.url.startsWith(self.location.origin) && "focus" in client) {
          const w = client as WindowClient;
          if ("navigate" in w && typeof w.navigate === "function") {
            void w.navigate(targetUrl);
          }
          return w.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow(targetUrl);
      }
    })
  );
});
