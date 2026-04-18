/**
 * Proxied through `/.netlify/functions/admin-gateway` (session + X-Admin-Path).
 */
export async function adminFetch(path: string, init?: RequestInit): Promise<Response> {
  const method = (init?.method ?? "GET").toUpperCase();
  return fetch("/.netlify/functions/admin-gateway", {
    ...init,
    method,
    credentials: "include",
    headers: {
      ...init?.headers,
      "X-Admin-Path": path,
      ...(method !== "GET" && method !== "HEAD" ? { "Content-Type": "application/json" } : {}),
    },
    body: init?.body,
  });
}

export type AdminEligibleGuild = {
  discordGuildId: string;
  name: string;
  iconUrl: string | null;
  rustServers: Array<{ id: number; nickname: string; slug: string }>;
};

export type AdminEligibleResponse = {
  ok: boolean;
  eligible?: boolean;
  guilds?: AdminEligibleGuild[];
  error?: string;
};

export async function fetchAdminEligible(): Promise<AdminEligibleResponse> {
  const res = await adminFetch("/api/admin/eligible");
  try {
    const j = (await res.json()) as AdminEligibleResponse;
    if (!res.ok) return { ok: false, error: (j as { error?: string }).error ?? `HTTP ${res.status}` };
    return j;
  } catch {
    return { ok: false, error: "Bad response" };
  }
}

export type DiscordMeta = {
  ok: boolean;
  channels?: Array<{ id: string; name: string }>;
  roles?: Array<{ id: string; name: string }>;
  error?: string;
};

export async function fetchAdminServerMeta(serverId: number): Promise<DiscordMeta> {
  const res = await adminFetch(`/api/admin/server/${serverId}/meta`);
  try {
    return (await res.json()) as DiscordMeta;
  } catch {
    return { ok: false, error: "Bad response" };
  }
}
