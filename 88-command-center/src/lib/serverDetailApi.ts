export type EventStatus = "none" | "pending" | "active";

export type ServerEventsResponse = {
  ok: true;
  serverId: number;
  koth: {
    status: EventStatus;
    phase?: "door_delay" | "wave_active" | "between_waves" | null;
    phaseEndsAtMs?: number | null;
    currentWave?: number | null;
    wavesTotal?: number | null;
    teleportCountdownMs?: number;
    doorDelayMs?: number;
    gatesTotal: number | null;
    joined: number;
    participants: { discordUserId: string; ingameName: string; clanId: number; clanName: string; gateNumber: number }[];
    ended: null | { status: "ended"; expiresAtMs: number; payload: unknown };
  };
  nuketown?: {
    status: EventStatus;
    lobbyEndsAtMs: number | null;
    teamLimit: number | null;
    joined: number;
    teams: { slot: number; clanId: number }[];
    participants: {
      discordUserId: string;
      ingameName: string;
      clanId: number;
      clanName: string;
      clanTag: string;
      clanColor?: string | null;
      teamSlot: number | null;
    }[];
    bracket: unknown | null;
    ended: null | { status: "ended"; expiresAtMs: number; payload: unknown };
  };
  maze: {
    status: EventStatus;
    spawnPointsTotal: number | null;
    joined: number;
    participants: { discordUserId: string; ingameName: string; clanName: string; spawnNumber: number }[];
    ended: null | { status: "ended"; expiresAtMs: number; payload: unknown };
  };
  onev1?: {
    enabled: boolean;
    configured: boolean;
    status: "none" | "pending" | "running";
    match: null | {
      matchId: number;
      challengerDiscordId: string;
      opponentDiscordId: string;
      challenger: {
        discordUserId: string;
        ingameName: string;
        clanTag: string;
        clanName: string;
        clanColor: string | null;
      };
      opponent: {
        discordUserId: string;
        ingameName: string;
        clanTag: string;
        clanName: string;
        clanColor: string | null;
      };
      state: unknown;
    };
    ended: null | { status: "ended"; expiresAtMs: number; payload: unknown };
  };
};

export type ServerLeaderboardResponse = {
  ok: true;
  serverId: number;
  leaderboard: { discordUserId: string; ingameName: string; kills: number; deaths: number; kdRatio: string }[];
};

export type MyStatsResponse =
  | { ok: true; linked: false }
  | { ok: true; linked: true; ingameName: string; kills: number; deaths: number; kdRatio: string };

export async function fetchServerEvents(serverId: number): Promise<ServerEventsResponse> {
  const res = await fetch(`/.netlify/functions/server-events?serverId=${encodeURIComponent(String(serverId))}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to fetch events (${res.status})`);
  return (await res.json()) as ServerEventsResponse;
}

export async function fetchServerLeaderboard(serverId: number): Promise<ServerLeaderboardResponse> {
  const res = await fetch(
    `/.netlify/functions/server-leaderboard?serverId=${encodeURIComponent(String(serverId))}`,
    { credentials: "include" }
  );
  if (!res.ok) throw new Error(`Failed to fetch leaderboard (${res.status})`);
  return (await res.json()) as ServerLeaderboardResponse;
}

export async function fetchMyStats(serverId: number): Promise<MyStatsResponse> {
  const res = await fetch(`/.netlify/functions/my-stats?serverId=${encodeURIComponent(String(serverId))}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to fetch stats (${res.status})`);
  return (await res.json()) as MyStatsResponse;
}

export async function postLink(serverId: number, ingameName: string): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`/.netlify/functions/link?serverId=${encodeURIComponent(String(serverId))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ingameName }),
  });
  const text = await res.text();
  if (res.ok) return { ok: true };
  try {
    const j = JSON.parse(text) as { error?: string };
    return { ok: false, error: j.error ?? `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: text || `HTTP ${res.status}` };
  }
}

async function postEventAction(serverId: number, eventType: "koth" | "maze" | "nuketown", action: "join" | "leave") {
  const res = await fetch(
    `/.netlify/functions/event-action?serverId=${encodeURIComponent(String(serverId))}&eventType=${encodeURIComponent(
      eventType
    )}&action=${encodeURIComponent(action)}`,
    { method: "POST", credentials: "include" }
  );
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { ok: false, error: text || `HTTP ${res.status}` };
  }
  if (!res.ok) throw new Error(parsed?.error ?? `HTTP ${res.status}`);
  return parsed as any;
}

export async function joinEventFromWebsite(serverId: number, eventType: "koth" | "maze" | "nuketown") {
  return await postEventAction(serverId, eventType, "join");
}

export async function leaveEventFromWebsite(serverId: number, eventType: "koth" | "maze" | "nuketown") {
  return await postEventAction(serverId, eventType, "leave");
}

export type SiteInboxMessage = {
  id: number;
  kind: string;
  title: string;
  body: string;
  payload: unknown;
  createdAtMs: number;
};

export async function fetchSiteInbox(): Promise<{ ok: true; messages: SiteInboxMessage[] }> {
  const res = await fetch("/.netlify/functions/me-inbox", { credentials: "include" });
  const text = await res.text();
  let parsed: { ok?: boolean; messages?: SiteInboxMessage[] } = {};
  try {
    parsed = JSON.parse(text) as { ok?: boolean; messages?: SiteInboxMessage[] };
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok || !parsed.ok) throw new Error((parsed as { error?: string }).error ?? `HTTP ${res.status}`);
  return { ok: true, messages: parsed.messages ?? [] };
}

export async function markSiteInboxRead(ids: number[]): Promise<void> {
  const res = await fetch("/.netlify/functions/me-inbox", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ ids }),
  });
  if (!res.ok) {
    const t = await res.text();
    throw new Error(t || `HTTP ${res.status}`);
  }
}

export type OneV1Candidate = { discordUserId: string; displayName: string; avatarUrl: string };

export async function fetchOneV1NominateCandidates(serverId: number): Promise<{ ok: true; candidates: OneV1Candidate[] }> {
  const res = await fetch(
    `/.netlify/functions/onev1-nominate-candidates?serverId=${encodeURIComponent(String(serverId))}`,
    { credentials: "include" }
  );
  const text = await res.text();
  let parsed: { ok?: boolean; candidates?: OneV1Candidate[]; error?: string } = {};
  try {
    parsed = JSON.parse(text) as { ok?: boolean; candidates?: OneV1Candidate[]; error?: string };
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok || !parsed.ok) throw new Error(parsed.error ?? `HTTP ${res.status}`);
  return { ok: true, candidates: parsed.candidates ?? [] };
}

export async function postOneV1Nominate(
  serverId: number,
  opponentDiscordId: string
): Promise<{ ok: true; matchId: number }> {
  const res = await fetch(`/.netlify/functions/onev1-nominate?serverId=${encodeURIComponent(String(serverId))}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    credentials: "include",
    body: JSON.stringify({ opponentDiscordId }),
  });
  const text = await res.text();
  let parsed: { ok?: boolean; matchId?: number; error?: string } = {};
  try {
    parsed = JSON.parse(text) as { ok?: boolean; matchId?: number; error?: string };
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok || !parsed.ok) throw new Error(parsed.error ?? `HTTP ${res.status}`);
  return { ok: true, matchId: Number(parsed.matchId) };
}

export async function postOneV1MatchAction(
  serverId: number,
  matchId: number,
  action: "accept" | "duck"
): Promise<void> {
  const res = await fetch(
    `/.netlify/functions/onev1-match-action?serverId=${encodeURIComponent(String(serverId))}&matchId=${encodeURIComponent(
      String(matchId)
    )}&action=${encodeURIComponent(action)}`,
    { method: "POST", credentials: "include" }
  );
  const text = await res.text();
  let parsed: { ok?: boolean; error?: string } = {};
  try {
    parsed = JSON.parse(text) as { ok?: boolean; error?: string };
  } catch {
    throw new Error(text || `HTTP ${res.status}`);
  }
  if (!res.ok || !parsed.ok) throw new Error(parsed.error ?? `HTTP ${res.status}`);
}

