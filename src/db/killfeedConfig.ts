import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export const DEFAULT_KILLFEED_FORMAT = "{Killer} killed {Victim}";

export type KillfeedConfigRow = {
  enabled: boolean;
  format_string: string;
  randomizer_enabled: boolean;
};

export async function getKillfeedConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<KillfeedConfigRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT enabled, format_string,
            COALESCE(randomizer_enabled, 0) AS randomizer_enabled
     FROM rust_killfeed_config
     WHERE guild_id = :gid AND rust_server_id = :sid LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  const r = rows[0] as { enabled: number; format_string: string; randomizer_enabled: number } | undefined;
  if (!r) return null;
  return {
    enabled: r.enabled === 1,
    format_string: r.format_string,
    randomizer_enabled: r.randomizer_enabled === 1,
  };
}

export async function upsertKillfeedEnabled(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  enabled: boolean
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO rust_killfeed_config (guild_id, rust_server_id, enabled, format_string, randomizer_enabled)
     VALUES (:gid, :sid, :en, :fmt, 0)
     ON DUPLICATE KEY UPDATE enabled = VALUES(enabled)`,
    {
      gid: guildRowId,
      sid: rustServerId,
      en: enabled ? 1 : 0,
      fmt: DEFAULT_KILLFEED_FORMAT,
    }
  );
}

export async function upsertKillfeedFormatString(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  formatString: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO rust_killfeed_config (guild_id, rust_server_id, enabled, format_string, randomizer_enabled)
     VALUES (:gid, :sid, 0, :fmt, 0)
     ON DUPLICATE KEY UPDATE format_string = VALUES(format_string)`,
    {
      gid: guildRowId,
      sid: rustServerId,
      fmt: formatString,
    }
  );
}

export async function upsertKillfeedRandomizer(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  randomizerEnabled: boolean
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO rust_killfeed_config (guild_id, rust_server_id, enabled, format_string, randomizer_enabled)
     VALUES (:gid, :sid, 0, :fmt, :rz)
     ON DUPLICATE KEY UPDATE randomizer_enabled = VALUES(randomizer_enabled)`,
    {
      gid: guildRowId,
      sid: rustServerId,
      fmt: DEFAULT_KILLFEED_FORMAT,
      rz: randomizerEnabled ? 1 : 0,
    }
  );
}
