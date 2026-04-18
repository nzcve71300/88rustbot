function urlBase64ToUint8Array(base64String: string): BufferSource {
  const padding = "=".repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

export const NOTIFY_PROMPT_STORAGE_KEY = "grindset_notify_prompt_v1";

export function getNotifyPromptStatus(): "none" | "dismissed" | "complete" {
  try {
    const v = localStorage.getItem(NOTIFY_PROMPT_STORAGE_KEY);
    if (v === "dismissed" || v === "complete") return v;
  } catch {
    /* ignore */
  }
  return "none";
}

export function markNotifyPromptDismissed(): void {
  try {
    localStorage.setItem(NOTIFY_PROMPT_STORAGE_KEY, "dismissed");
  } catch {
    /* ignore */
  }
}

export function markNotifyPromptComplete(): void {
  try {
    localStorage.setItem(NOTIFY_PROMPT_STORAGE_KEY, "complete");
  } catch {
    /* ignore */
  }
}

/**
 * Web Push: supported in Chromium/Android; Safari **iOS 16.4+** only after **Add to Home Screen**
 * (standalone PWA). `PushManager` may be absent until then.
 */
export function pushApisSupported(): boolean {
  return typeof window !== "undefined" && "serviceWorker" in navigator && "PushManager" in window;
}

export async function getExistingPushSubscription(): Promise<PushSubscription | null> {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

export async function fetchPushEligible(): Promise<{ ok: boolean; linked?: boolean }> {
  const res = await fetch("/.netlify/functions/push-eligible", { credentials: "include" });
  return (await res.json()) as { ok: boolean; linked?: boolean };
}

export type PushServerScopePayload = {
  ok: true;
  eligibleRustServerIds: number[];
  restrictToServers: boolean;
  rustServerIds: number[];
};

export async function fetchPushServerScope(): Promise<PushServerScopePayload | { ok: false }> {
  const res = await fetch("/.netlify/functions/push-server-scope", { credentials: "include" });
  return (await res.json()) as PushServerScopePayload | { ok: false };
}

export async function savePushServerScope(rustServerIds: number[]): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch("/.netlify/functions/push-server-scope", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rustServerIds }),
  });
  const text = await res.text();
  let parsed: { ok?: boolean; error?: string } = {};
  try {
    parsed = JSON.parse(text) as { ok?: boolean; error?: string };
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    return { ok: false, error: parsed.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

/** Subscribe without `serverId` if the user has linked in any guild (profile / site-wide). */
export async function subscribeToPushNotifications(serverId?: number | null): Promise<{ ok: boolean; error?: string }> {
  if (!pushApisSupported()) {
    return { ok: false, error: "Push is not supported in this browser." };
  }

  const vapidRes = await fetch("/.netlify/functions/push-vapid-public");
  const vapidJson = (await vapidRes.json()) as { ok?: boolean; publicKey?: string; error?: string };
  if (!vapidRes.ok || !vapidJson.ok || !vapidJson.publicKey) {
    return { ok: false, error: vapidJson.error ?? "Push is not configured (missing VAPID key on the site)." };
  }

  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: urlBase64ToUint8Array(vapidJson.publicKey),
  });

  const useServer =
    serverId != null && Number.isFinite(Number(serverId)) && Number(serverId) >= 1 ? Number(serverId) : null;
  const q =
    useServer != null ? `?serverId=${encodeURIComponent(String(useServer))}` : "";

  const res = await fetch(`/.netlify/functions/push-subscribe${q}`, {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(sub.toJSON()),
  });
  const text = await res.text();
  let parsed: { ok?: boolean; error?: string } = {};
  try {
    parsed = JSON.parse(text) as { ok?: boolean; error?: string };
  } catch {
    parsed = {};
  }
  if (!res.ok) {
    await sub.unsubscribe().catch(() => {});
    return { ok: false, error: parsed.error ?? `HTTP ${res.status}` };
  }
  return { ok: true };
}

export async function unsubscribeFromPushNotifications(): Promise<void> {
  if (!pushApisSupported()) return;
  const reg = await navigator.serviceWorker.ready;
  const sub = await reg.pushManager.getSubscription();
  if (!sub) return;
  const endpoint = sub.endpoint;
  await fetch("/.netlify/functions/push-unsubscribe", {
    method: "POST",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ endpoint }),
  }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}
