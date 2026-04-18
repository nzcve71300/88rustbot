export type ClanMeResponse =
  | { ok: true; linked: true; inClan: false }
  | {
      ok: true;
      linked: true;
      inClan: true;
      clan: { clanId: number; clanName: string; clanTag: string | null; clanColor: string | null; ownerDiscordUserId: string | null };
      members: { discordUserId: string; ingameName: string; avatarUrl: string }[];
    };

export type ClanStatsResponse = {
  ok: true;
  clan: { clanId: number; clanName: string; clanTag: string | null; clanColor: string | null };
  totalMembers: number;
  totalKills: number;
  totalDeaths: number;
  kdRatio: string;
  top3: { discordUserId: string; ingameName: string; kills: number; deaths: number }[];
  leaderboard: { discordUserId: string; ingameName: string; kills: number; deaths: number }[];
};

async function clanAction(serverId: number, action: string, body?: unknown): Promise<any> {
  const res = await fetch(
    `/.netlify/functions/clan-action?serverId=${encodeURIComponent(String(serverId))}&action=${encodeURIComponent(action)}`,
    {
      method: body === undefined ? "POST" : "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "include",
      body: body === undefined ? "{}" : JSON.stringify(body),
    }
  );
  const text = await res.text();
  let parsed: any = null;
  try {
    parsed = JSON.parse(text);
  } catch {
    parsed = { ok: false, error: text || `HTTP ${res.status}` };
  }
  if (!res.ok) throw new Error(parsed?.error ?? `HTTP ${res.status}`);
  return parsed;
}

export async function fetchClanMe(serverId: number): Promise<ClanMeResponse> {
  const res = await fetch(`/.netlify/functions/clan-me?serverId=${encodeURIComponent(String(serverId))}`, {
    credentials: "include",
  });
  if (!res.ok) throw new Error(`Failed to fetch clan (${res.status})`);
  return (await res.json()) as ClanMeResponse;
}

export async function createClanOnWebsite(serverId: number, input: { name: string; tag: string; color: string }) {
  return await clanAction(serverId, "create", input);
}

export async function joinClanOnWebsite(serverId: number, code: string) {
  return await clanAction(serverId, "join", { code });
}

export async function leaveClanOnWebsite(serverId: number) {
  return await clanAction(serverId, "leave");
}

export async function inviteClanOnWebsite(serverId: number) {
  return await clanAction(serverId, "invite");
}

export async function kickClanMember(serverId: number, userId: string) {
  return await clanAction(serverId, "kick", { userId });
}

export async function promoteClanMember(serverId: number, userId: string) {
  return await clanAction(serverId, "promote", { userId });
}

export async function deleteClanOnWebsite(serverId: number, confirm: string) {
  return await clanAction(serverId, "delete", { confirm });
}

export async function fetchClanStats(serverId: number): Promise<ClanStatsResponse> {
  const res = await fetch(
    `/.netlify/functions/clan-action?serverId=${encodeURIComponent(String(serverId))}&action=stats`,
    { credentials: "include" }
  );
  const text = await res.text();
  const parsed = JSON.parse(text) as ClanStatsResponse;
  if (!res.ok) throw new Error((parsed as any)?.error ?? `HTTP ${res.status}`);
  return parsed;
}

