export type HostnameSegment = { text: string; color?: string };

export type RealServer = {
  id: number;
  nickname: string;
  slug: string;
  ip: string;
  rconPort: number;
  hostnameSegments: HostnameSegment[];
  hostnamePlain: string;
  players: number | null;
  maxPlayers: number | null;
  map: string | null;
  uptime: number | null;
  ok: boolean;
  error: string | null;
};

export async function fetchServers(): Promise<RealServer[]> {
  const res = await fetch("/.netlify/functions/servers", { credentials: "include" });
  if (!res.ok) throw new Error(`Failed to fetch servers (${res.status})`);
  const json = (await res.json()) as { servers: RealServer[] };
  return json.servers ?? [];
}

