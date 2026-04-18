import type { Pool, ResultSetHeader } from "mysql2/promise";

export async function incrementPlayerKills(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  ingameName: string,
  amount = 1
): Promise<void> {
  const name = ingameName.trim().slice(0, 128);
  if (!name) return;
  await pool.query<ResultSetHeader>(
    `INSERT INTO rust_player_kd (guild_id, rust_server_id, ingame_name, kills, deaths)
     VALUES (:gid, :sid, :name, :k, 0)
     ON DUPLICATE KEY UPDATE kills = kills + :k`,
    { gid: guildRowId, sid: rustServerId, name, k: amount }
  );
}

export async function incrementPlayerDeaths(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  ingameName: string,
  amount = 1
): Promise<void> {
  const name = ingameName.trim().slice(0, 128);
  if (!name) return;
  await pool.query<ResultSetHeader>(
    `INSERT INTO rust_player_kd (guild_id, rust_server_id, ingame_name, kills, deaths)
     VALUES (:gid, :sid, :name, 0, :d)
     ON DUPLICATE KEY UPDATE deaths = deaths + :d`,
    { gid: guildRowId, sid: rustServerId, name, d: amount }
  );
}

