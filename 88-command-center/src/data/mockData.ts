// Legacy mock types/data (kept for future UI widgets).

export interface GameEvent {
  id: string;
  name: string;
  icon: string;
  active: boolean;
}

export interface LeaderboardEntry {
  rank: number;
  playerName: string;
  kills: number;
}

export interface PlayerStats {
  kills: number;
  deaths: number;
  kdRatio: number;
}

export const servers = [];

export const serverEvents: Record<string, GameEvent[]> = {
  "1": [
    { id: "e1", name: "KOTH", icon: "crown", active: true },
    { id: "e2", name: "Convoy", icon: "truck", active: true },
  ],
  "2": [],
  "3": [
    { id: "e3", name: "Maze Event", icon: "grid3x3", active: true },
    { id: "e4", name: "Supply Drop", icon: "package", active: true },
    { id: "e5", name: "Heli Patrol", icon: "plane", active: true },
  ],
  "4": [],
  "5": [
    { id: "e6", name: "KOTH", icon: "crown", active: true },
  ],
  "6": [],
};

export const serverLeaderboards: Record<string, LeaderboardEntry[]> = {
  "1": [
    { rank: 1, playerName: "xXShadowKingXx", kills: 342 },
    { rank: 2, playerName: "RustLord88", kills: 298 },
    { rank: 3, playerName: "NightHunter", kills: 276 },
    { rank: 4, playerName: "IronWolf", kills: 234 },
    { rank: 5, playerName: "DeadShot", kills: 212 },
    { rank: 6, playerName: "Raider_X", kills: 198 },
    { rank: 7, playerName: "GhostRecon", kills: 187 },
    { rank: 8, playerName: "BloodFang", kills: 165 },
    { rank: 9, playerName: "StormBreaker", kills: 154 },
    { rank: 10, playerName: "ViperStrike", kills: 143 },
    { rank: 11, playerName: "WarMachine", kills: 132 },
    { rank: 12, playerName: "DarkPhoenix", kills: 121 },
  ],
  "3": [
    { rank: 1, playerName: "ChaosAgent", kills: 512 },
    { rank: 2, playerName: "BulletProof", kills: 478 },
    { rank: 3, playerName: "Annihilator", kills: 445 },
    { rank: 4, playerName: "SavageOne", kills: 398 },
    { rank: 5, playerName: "Predator_X", kills: 367 },
    { rank: 6, playerName: "HellRaiser", kills: 334 },
    { rank: 7, playerName: "ToxicWaste", kills: 312 },
    { rank: 8, playerName: "Demolisher", kills: 289 },
    { rank: 9, playerName: "NukeStrike", kills: 267 },
    { rank: 10, playerName: "Warlord", kills: 245 },
    { rank: 11, playerName: "Reaper_88", kills: 223 },
    { rank: 12, playerName: "Executioner", kills: 201 },
  ],
};

// Default leaderboard for servers without specific data
export const defaultLeaderboard: LeaderboardEntry[] = [
  { rank: 1, playerName: "TopPlayer", kills: 156 },
  { rank: 2, playerName: "SecondBest", kills: 134 },
  { rank: 3, playerName: "ThirdPlace", kills: 112 },
  { rank: 4, playerName: "Player4", kills: 98 },
  { rank: 5, playerName: "Player5", kills: 87 },
  { rank: 6, playerName: "Player6", kills: 76 },
  { rank: 7, playerName: "Player7", kills: 65 },
  { rank: 8, playerName: "Player8", kills: 54 },
  { rank: 9, playerName: "Player9", kills: 43 },
  { rank: 10, playerName: "Player10", kills: 32 },
  { rank: 11, playerName: "Player11", kills: 21 },
  { rank: 12, playerName: "Player12", kills: 10 },
];

export const myStats: Record<string, PlayerStats | null> = {
  "1": { kills: 87, deaths: 34, kdRatio: 2.56 },
  "2": { kills: 12, deaths: 8, kdRatio: 1.5 },
  "3": null,
  "4": { kills: 5, deaths: 2, kdRatio: 2.5 },
  "5": { kills: 234, deaths: 156, kdRatio: 1.5 },
  "6": null,
};

export function getServerBySlug(slug: string): Server | undefined {
  return servers.find(s => s.slug === slug);
}

export function getLeaderboard(serverId: string): LeaderboardEntry[] {
  return serverLeaderboards[serverId] || defaultLeaderboard;
}
