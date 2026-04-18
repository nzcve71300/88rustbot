import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export async function countGuildServers(pool: Pool, guildId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS c FROM rust_servers WHERE guild_id = :gid",
    { gid: guildId }
  );
  return Number((rows[0] as { c: number }).c);
}

export async function insertRustServer(
  pool: Pool,
  guildId: number,
  nickname: string,
  serverIp: string,
  rconPort: number,
  rconPasswordEncrypted: Buffer
): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO rust_servers (guild_id, nickname, server_ip, rcon_port, rcon_password_encrypted)
     VALUES (:guildId, :nickname, :serverIp, :rconPort, :password)`,
    {
      guildId,
      nickname,
      serverIp,
      rconPort,
      password: rconPasswordEncrypted,
    }
  );
  return Number(res.insertId);
}

export async function listRustServersForGuild(
  pool: Pool,
  guildId: number
): Promise<{ id: number; nickname: string }[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT id, nickname FROM rust_servers WHERE guild_id = :gid ORDER BY nickname ASC",
    { gid: guildId }
  );
  return rows as { id: number; nickname: string }[];
}

export type RustServerRow = {
  id: number;
  nickname: string;
  server_ip: string;
  rcon_port: number;
  rcon_password_encrypted: Buffer;
};

export async function getRustServerByIdForGuild(
  pool: Pool,
  guildRowId: number,
  serverId: number
): Promise<RustServerRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, nickname, server_ip, rcon_port, rcon_password_encrypted
     FROM rust_servers WHERE id = :sid AND guild_id = :gid LIMIT 1`,
    { sid: serverId, gid: guildRowId }
  );
  const row = rows[0] as RustServerRow | undefined;
  return row ?? null;
}

export type RustServerCredentialsRow = {
  id: number;
  guild_id: number;
  nickname: string;
  server_ip: string;
  rcon_port: number;
  rcon_password_encrypted: Buffer;
};

/** All configured Rust servers (for console listeners). */
export async function listAllRustServers(pool: Pool): Promise<RustServerCredentialsRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, guild_id, nickname, server_ip, rcon_port, rcon_password_encrypted
     FROM rust_servers ORDER BY id ASC`
  );
  return rows as RustServerCredentialsRow[];
}

export async function getGuildRowIdForRustServerId(pool: Pool, rustServerId: number): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT guild_id AS guildRowId FROM rust_servers WHERE id = :sid LIMIT 1`,
    { sid: rustServerId }
  );
  const r = rows[0] as { guildRowId: number } | undefined;
  return r ? Number(r.guildRowId) : null;
}
