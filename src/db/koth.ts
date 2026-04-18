import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type KothConfig = {
  rustServerId: number;
  announcementChannelId: string;
  announcementRoleId: string | null;
  gates: number;
  gateFrequency: number;
  messageId: string | null;
};

export async function upsertKothConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  announcementChannelId: string,
  announcementRoleId: string | null,
  gates: number,
  gateFrequency: number,
  messageId: string | null
) {
  await pool.query<ResultSetHeader>(
    `
    INSERT INTO koth_configs (guild_id, rust_server_id, announcement_channel_id, announcement_role_id, gates, gate_frequency, message_id)
    VALUES (:gid, :sid, :chan, :role, :gates, :freq, :msg)
    ON DUPLICATE KEY UPDATE
      announcement_channel_id = VALUES(announcement_channel_id),
      announcement_role_id = VALUES(announcement_role_id),
      gates = VALUES(gates),
      gate_frequency = VALUES(gate_frequency),
      message_id = VALUES(message_id)
  `,
    { gid: guildRowId, sid: rustServerId, chan: announcementChannelId, role: announcementRoleId, gates, freq: gateFrequency, msg: messageId }
  );
}

export async function getKothConfig(pool: Pool, guildRowId: number, rustServerId: number): Promise<KothConfig | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT rust_server_id as rustServerId,
            CAST(announcement_channel_id AS CHAR) as announcementChannelId,
            CAST(announcement_role_id AS CHAR) as announcementRoleId,
            gates, gate_frequency as gateFrequency,
            CAST(message_id AS CHAR) as messageId
     FROM koth_configs WHERE guild_id = :gid AND rust_server_id = :sid LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  return (rows[0] as KothConfig | undefined) ?? null;
}

export type KothEvent = {
  id: number;
  status: string;
  currentWave: number;
};

/** Latest non-finished KOTH for this Rust server (lobby or running). */
export async function getActiveKothEvent(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<{ id: number; status: string } | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status FROM koth_events
     WHERE guild_id = :gid AND rust_server_id = :sid AND status IN ('lobby','running')
     ORDER BY id DESC LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  const r = rows[0] as { id: number; status: string } | undefined;
  return r ? { id: Number(r.id), status: String(r.status) } : null;
}

/** Same as active event, plus timing for website (KOTH phases). */
export async function getActiveKothEventMeta(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<{
  id: number;
  status: string;
  currentWave: number;
  waveStartedAtMs: number | null;
  durationPerWaveMin: number | null;
  wavesTotal: number | null;
} | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id, status, current_wave AS currentWave,
            CASE WHEN wave_started_at IS NULL THEN NULL ELSE UNIX_TIMESTAMP(wave_started_at) * 1000 END AS waveStartedAtMs,
            duration_per_wave_min AS durationPerWaveMin,
            waves AS wavesTotal
     FROM koth_events
     WHERE guild_id = :gid AND rust_server_id = :sid AND status IN ('lobby','running')
     ORDER BY id DESC LIMIT 1`,
    { gid: guildRowId, sid: rustServerId }
  );
  const r = rows[0] as
    | {
        id: number;
        status: string;
        currentWave: number;
        waveStartedAtMs: number | null;
        durationPerWaveMin: number | null;
        wavesTotal: number | null;
      }
    | undefined;
  if (!r) return null;
  return {
    id: Number(r.id),
    status: String(r.status),
    currentWave: Number(r.currentWave),
    waveStartedAtMs: r.waveStartedAtMs != null ? Number(r.waveStartedAtMs) : null,
    durationPerWaveMin: r.durationPerWaveMin != null ? Number(r.durationPerWaveMin) : null,
    wavesTotal: r.wavesTotal != null ? Number(r.wavesTotal) : null,
  };
}

/** Always 0 — pre-teleport countdown was removed; phase API uses 0 for alignment with the runner. */
export function getKothTeleportCountdownMs(): number {
  return 0;
}

/** After kits+teleport, wait this long before opening doors / broadcaster (default 60s). */
export function getKothDoorDelayMs(): number {
  const v = process.env.KOTH_DOOR_DELAY_MS?.trim() ?? process.env.KOTH_PRESTART_MS?.trim();
  if (v === undefined || v === "") return 60_000;
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) && n >= 0 ? n : 60_000;
}

/** @deprecated Use getKothDoorDelayMs */
export function getKothPrestartMs(): number {
  return getKothDoorDelayMs();
}

/** Alias: teleport countdown length (same as getKothTeleportCountdownMs). */
export function getKothCountdownMs(): number {
  return getKothTeleportCountdownMs();
}

/** Lobby or running KOTH roster for this Rust server (blocks joining Maze on same server). */
export async function isDiscordUserInActiveKothOnServer(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  discordUserId: string
): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT 1
     FROM koth_event_members m
     INNER JOIN koth_events e ON e.id = m.event_id
     WHERE e.guild_id = :gid AND e.rust_server_id = :sid
       AND e.status IN ('lobby','running')
       AND CAST(m.discord_user_id AS CHAR) = :uid
     LIMIT 1`,
    { gid: guildRowId, sid: rustServerId, uid: String(discordUserId) }
  );
  return rows.length > 0;
}

export type LobbyForJoinResult =
  | { ok: true; eventId: number }
  | { ok: false; reason: "running" };

/** Use for /koth-join: reuse lobby row or create one; refuse if a run is in progress. */
export async function ensureLobbyEventForJoin(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<LobbyForJoinResult> {
  const active = await getActiveKothEvent(pool, guildRowId, rustServerId);
  if (active?.status === "running") {
    return { ok: false, reason: "running" };
  }
  if (active?.status === "lobby") {
    return { ok: true, eventId: active.id };
  }

  const [res] = await pool.query<ResultSetHeader>(
    `INSERT INTO koth_events (guild_id, rust_server_id, status) VALUES (:gid, :sid, 'lobby')`,
    { gid: guildRowId, sid: rustServerId }
  );
  return { ok: true, eventId: Number(res.insertId) };
}


export async function countEventMembers(pool: Pool, eventId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM koth_event_members WHERE event_id = :eid`,
    { eid: eventId }
  );
  return Number((rows[0] as { c: number }).c);
}

export async function startKothEvent(
  pool: Pool,
  eventId: number,
  durationPerWaveMin: number,
  waves: number,
  kitName: string
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    `UPDATE koth_events SET
       status = 'running',
       duration_per_wave_min = :dmin,
       waves = :waves,
       kit_name = :kit,
       current_wave = 1,
       wave_started_at = NULL
     WHERE id = :eid AND status = 'lobby'`,
    { eid: eventId, dmin: durationPerWaveMin, waves, kit: kitName }
  );
  return res.affectedRows > 0;
}

export async function finishKothEvent(pool: Pool, eventId: number): Promise<void> {
  await pool.query<ResultSetHeader>(
    `UPDATE koth_events SET status = 'finished' WHERE id = :eid`,
    { eid: eventId }
  );
}

/**
 * Successful KOTH completion: removes the event (members/kills cascade) and `koth_configs`
 * so admins must run `/koth-setup` again. Does **not** delete `koth_gate_coords`.
 */
export async function deleteKothEventAndClearConfig(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  eventId: number
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `DELETE FROM koth_events WHERE id = :eid AND guild_id = :gid`,
    { eid: eventId, gid: guildRowId }
  );
  await pool.query<ResultSetHeader>(
    `DELETE FROM koth_configs WHERE guild_id = :gid AND rust_server_id = :sid`,
    { gid: guildRowId, sid: rustServerId }
  );
}

export async function setKothWave(pool: Pool, eventId: number, wave: number): Promise<void> {
  await pool.query<ResultSetHeader>(
    `UPDATE koth_events SET current_wave = :wave, wave_started_at = CURRENT_TIMESTAMP WHERE id = :eid`,
    { eid: eventId, wave }
  );
}

export async function incrementKothKill(
  pool: Pool,
  eventId: number,
  wave: number,
  clanId: number,
  discordUserId: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO koth_kills (event_id, wave, clan_id, discord_user_id, kills)
     VALUES (:eid, :wave, :cid, :uid, 1)
     ON DUPLICATE KEY UPDATE kills = kills + 1`,
    { eid: eventId, wave, cid: clanId, uid: discordUserId }
  );
}

/** One row per scored kill — scoped by guild + event (data stays in this Discord). */
export type KothKillLogRow = {
  killerDiscordUserId: string;
  victimDiscordUserId: string | null;
  killerLabel: string;
  victimLabel: string;
};

export async function insertKothKillLog(
  pool: Pool,
  guildRowId: number,
  eventId: number,
  wave: number,
  killerDiscordUserId: string,
  victimDiscordUserId: string | null,
  killerLabel: string,
  victimLabel: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO koth_kill_log (guild_id, event_id, wave, killer_discord_user_id, victim_discord_user_id, killer_label, victim_label)
     VALUES (:gid, :eid, :wave, :kid, :vid, :kl, :vl)`,
    {
      gid: guildRowId,
      eid: eventId,
      wave,
      kid: killerDiscordUserId,
      vid: victimDiscordUserId,
      kl: killerLabel.slice(0, 128),
      vl: victimLabel.slice(0, 128),
    }
  );
}

export async function listKothKillLogForWave(
  pool: Pool,
  guildRowId: number,
  eventId: number,
  wave: number
): Promise<KothKillLogRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(killer_discord_user_id AS CHAR) AS killerDiscordUserId,
            CAST(victim_discord_user_id AS CHAR) AS victimDiscordUserId,
            killer_label AS killerLabel,
            victim_label AS victimLabel
     FROM koth_kill_log
     WHERE guild_id = :gid AND event_id = :eid AND wave = :wave
     ORDER BY id ASC`,
    { gid: guildRowId, eid: eventId, wave }
  );
  return (rows as KothKillLogRow[]).map((r) => ({
    killerDiscordUserId: String(r.killerDiscordUserId),
    victimDiscordUserId:
      r.victimDiscordUserId != null && String(r.victimDiscordUserId).length > 0
        ? String(r.victimDiscordUserId)
        : null,
    killerLabel: String(r.killerLabel),
    victimLabel: String(r.victimLabel),
  }));
}

export type KothParticipantRow = {
  discordUserId: string;
  clanId: number;
  ingameName: string;
  gateNumber: number;
};

export type KothParticipantWithClanRow = KothParticipantRow & { clanName: string };

/** Everyone in the event with a /link — used for kill matching (no gate join so no one is dropped). */
export type KothRosterKillRow = {
  discordUserId: string;
  clanId: number;
  ingameName: string;
};

export async function listKothEventRosterForKills(
  pool: Pool,
  guildRowId: number,
  eventId: number
): Promise<KothRosterKillRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(m.discord_user_id AS CHAR) AS discordUserId,
            m.clan_id AS clanId,
            l.ingame_name AS ingameName
     FROM koth_event_members m
     INNER JOIN discord_links l
       ON l.guild_id = :gid AND l.discord_user_id = m.discord_user_id
     WHERE m.event_id = :eid`,
    { gid: guildRowId, eid: eventId }
  );
  return (rows as KothRosterKillRow[]).map((r) => ({
    discordUserId: String(r.discordUserId),
    clanId: Number(r.clanId),
    ingameName: String(r.ingameName),
  }));
}

export async function listKothParticipantsWithGates(
  pool: Pool,
  guildRowId: number,
  eventId: number
): Promise<KothParticipantRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(m.discord_user_id AS CHAR) AS discordUserId,
            m.clan_id AS clanId,
            l.ingame_name AS ingameName,
            g.gate_number AS gateNumber
     FROM koth_event_members m
     JOIN discord_links l
       ON l.guild_id = :gid AND l.discord_user_id = m.discord_user_id
     JOIN koth_event_gates g
       ON g.event_id = m.event_id AND g.clan_id = m.clan_id
     WHERE m.event_id = :eid
     ORDER BY g.gate_number ASC, m.joined_at ASC`,
    { gid: guildRowId, eid: eventId }
  );
  return (rows as KothParticipantRow[]).map((r) => ({
    discordUserId: String(r.discordUserId),
    clanId: Number(r.clanId),
    ingameName: String(r.ingameName),
    gateNumber: Number(r.gateNumber),
  }));
}

export async function listKothParticipantsWithGatesAndClan(
  pool: Pool,
  guildRowId: number,
  eventId: number
): Promise<KothParticipantWithClanRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(m.discord_user_id AS CHAR) AS discordUserId,
            m.clan_id AS clanId,
            COALESCE(c.name, CONCAT('Clan ', m.clan_id)) AS clanName,
            l.ingame_name AS ingameName,
            g.gate_number AS gateNumber
     FROM koth_event_members m
     JOIN discord_links l
       ON l.guild_id = :gid AND l.discord_user_id = m.discord_user_id
     JOIN koth_event_gates g
       ON g.event_id = m.event_id AND g.clan_id = m.clan_id
     LEFT JOIN clans c ON c.id = m.clan_id
     WHERE m.event_id = :eid
     ORDER BY g.gate_number ASC, m.joined_at ASC`,
    { gid: guildRowId, eid: eventId }
  );
  return (rows as KothParticipantWithClanRow[]).map((r) => ({
    discordUserId: String(r.discordUserId),
    clanId: Number(r.clanId),
    clanName: String((r as { clanName: string }).clanName),
    ingameName: String(r.ingameName),
    gateNumber: Number(r.gateNumber),
  }));
}

export async function getClanIdForEventMember(
  pool: Pool,
  eventId: number,
  discordUserId: string
): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT clan_id AS clanId FROM koth_event_members
     WHERE event_id = :eid AND CAST(discord_user_id AS CHAR) = :uid LIMIT 1`,
    { eid: eventId, uid: String(discordUserId) }
  );
  const r = rows[0] as { clanId: number } | undefined;
  return r ? Number(r.clanId) : null;
}

export type WaveKillRow = {
  discordUserId: string;
  kills: number;
  clanId: number;
  clanName: string;
};

export async function listWaveKillsDetailed(
  pool: Pool,
  eventId: number,
  wave: number
): Promise<WaveKillRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(k.discord_user_id AS CHAR) AS discordUserId,
            k.kills AS kills,
            k.clan_id AS clanId,
            COALESCE(c.name, CONCAT('Clan ', k.clan_id)) AS clanName
     FROM koth_kills k
     LEFT JOIN clans c ON c.id = k.clan_id
     WHERE k.event_id = :eid AND k.wave = :wave
     ORDER BY k.kills DESC, clanName ASC`,
    { eid: eventId, wave }
  );
  return (rows as WaveKillRow[]).map((r) => ({
    discordUserId: String(r.discordUserId),
    kills: Number(r.kills),
    clanId: Number(r.clanId),
    clanName: String(r.clanName),
  }));
}

export type ClanWaveTotal = { clanName: string; total: number };

/** Top killer across all waves (linked in-game name + clan). Null if no scored kills. */
export type EventTopKillerRow = { clanName: string; ingameName: string };

export async function getKothEventTopKillerWithLink(
  pool: Pool,
  guildRowId: number,
  eventId: number
): Promise<EventTopKillerRow | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(c.name), CONCAT('Clan ', MAX(k.clan_id))) AS clanName,
            MAX(l.ingame_name) AS ingameName,
            SUM(k.kills) AS totalKills
     FROM koth_kills k
     LEFT JOIN clans c ON c.id = k.clan_id
     INNER JOIN discord_links l ON l.guild_id = :gid AND l.discord_user_id = k.discord_user_id
     WHERE k.event_id = :eid
     GROUP BY k.discord_user_id
     ORDER BY totalKills DESC, clanName ASC, ingameName ASC
     LIMIT 1`,
    { gid: guildRowId, eid: eventId }
  );
  const r = rows[0] as { clanName: string; ingameName: string; totalKills: number } | undefined;
  if (!r || Number(r.totalKills) < 1) return null;
  return { clanName: String(r.clanName), ingameName: String(r.ingameName) };
}

export async function sumKillsByClanForWave(
  pool: Pool,
  eventId: number,
  wave: number
): Promise<ClanWaveTotal[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COALESCE(MAX(c.name), CONCAT('Clan ', k.clan_id)) AS clanName, SUM(k.kills) AS total
     FROM koth_kills k
     LEFT JOIN clans c ON c.id = k.clan_id
     WHERE k.event_id = :eid AND k.wave = :wave
     GROUP BY k.clan_id
     ORDER BY total DESC`,
    { eid: eventId, wave }
  );
  return (rows as { clanName: string; total: number }[]).map((r) => ({
    clanName: String(r.clanName),
    total: Number(r.total),
  }));
}

/** Raw row count for debugging (ignores clan JOIN). */
export async function countKothKillsForWave(
  pool: Pool,
  eventId: number,
  wave: number
): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM koth_kills WHERE event_id = :eid AND wave = :wave`,
    { eid: eventId, wave }
  );
  return Number((rows[0] as { c: number }).c);
}

export async function getGateCoord(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  gateNumber: number
): Promise<string | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT coord FROM koth_gate_coords WHERE guild_id = :gid AND rust_server_id = :sid AND gate_number = :gn LIMIT 1`,
    { gid: guildRowId, sid: rustServerId, gn: gateNumber }
  );
  const r = rows[0] as { coord: string } | undefined;
  return r?.coord ? String(r.coord) : null;
}

export async function upsertGateCoord(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  gateNumber: number,
  coord: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO koth_gate_coords (guild_id, rust_server_id, gate_number, coord)
     VALUES (:gid, :sid, :gn, :coord)
     ON DUPLICATE KEY UPDATE coord = VALUES(coord)`,
    { gid: guildRowId, sid: rustServerId, gn: gateNumber, coord }
  );
}

export async function addEventMember(
  pool: Pool,
  eventId: number,
  clanId: number,
  discordUserId: string
): Promise<"added" | "already_joined"> {
  try {
    await pool.query<ResultSetHeader>(
      `INSERT INTO koth_event_members (event_id, clan_id, discord_user_id) VALUES (:eid, :cid, :uid)`,
      { eid: eventId, cid: clanId, uid: discordUserId }
    );
    return "added";
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
    if (code === "ER_DUP_ENTRY") return "already_joined";
    throw e;
  }
}

export async function removeEventMember(pool: Pool, eventId: number, discordUserId: string): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    `DELETE FROM koth_event_members WHERE event_id = :eid AND discord_user_id = :uid`,
    { eid: eventId, uid: discordUserId }
  );
  return res.affectedRows > 0;
}

export async function getClanGate(pool: Pool, eventId: number, clanId: number): Promise<number | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT gate_number AS gateNumber FROM koth_event_gates WHERE event_id = :eid AND clan_id = :cid LIMIT 1`,
    { eid: eventId, cid: clanId }
  );
  const r = rows[0] as { gateNumber: number } | undefined;
  return r ? Number(r.gateNumber) : null;
}

export async function assignGate(pool: Pool, eventId: number, gateNumber: number, clanId: number): Promise<void> {
  await pool.query<ResultSetHeader>(
    `INSERT INTO koth_event_gates (event_id, gate_number, clan_id) VALUES (:eid, :gate, :cid)`,
    { eid: eventId, gate: gateNumber, cid: clanId }
  );
}

export async function removeGateIfEmpty(pool: Pool, eventId: number, clanId: number): Promise<void> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT COUNT(*) AS c FROM koth_event_members WHERE event_id = :eid AND clan_id = :cid`,
    { eid: eventId, cid: clanId }
  );
  const c = Number((rows[0] as { c: number }).c);
  if (c > 0) return;
  await pool.query<ResultSetHeader>(
    `DELETE FROM koth_event_gates WHERE event_id = :eid AND clan_id = :cid`,
    { eid: eventId, cid: clanId }
  );
}

export async function listGateViews(
  pool: Pool,
  eventId: number
): Promise<{ gateNumber: number; clanName: string; members: string[] }[]> {
  const [gateRows] = await pool.query<RowDataPacket[]>(
    `SELECT g.gate_number AS gateNumber, c.name AS clanName, g.clan_id AS clanId
     FROM koth_event_gates g
     JOIN clans c ON c.id = g.clan_id
     WHERE g.event_id = :eid
     ORDER BY g.gate_number ASC`,
    { eid: eventId }
  );

  const gates = gateRows as { gateNumber: number; clanName: string; clanId: number }[];
  const out: { gateNumber: number; clanName: string; members: string[] }[] = [];
  for (const g of gates) {
    const [memRows] = await pool.query<RowDataPacket[]>(
      `SELECT CAST(discord_user_id AS CHAR) AS uid
       FROM koth_event_members WHERE event_id = :eid AND clan_id = :cid ORDER BY joined_at ASC`,
      { eid: eventId, cid: g.clanId }
    );
    const members = (memRows as { uid: string }[]).map((r) => `<@${r.uid}>`);
    out.push({ gateNumber: Number(g.gateNumber), clanName: g.clanName, members });
  }
  return out;
}

