import type { Pool } from "mysql2/promise";
import type { RowDataPacket } from "mysql2";

/** User-facing copy when joining a second event without leaving the first. */
export const EVENT_JOIN_BLOCKED_MESSAGE =
  "Oops looks like you are already in a event, leave that event to participate in this one.";

export type EventParticipationSlot =
  | { kind: "koth"; rustServerId: number }
  | { kind: "maze"; rustServerId: number }
  | { kind: "nuketown"; rustServerId: number }
  | { kind: "onev1"; rustServerId: number };

/**
 * All active lobby/running event rosters for this Discord guild member (any Rust server),
 * plus pending/active 1v1 matches.
 */
export async function listActiveEventParticipationSlots(
  pool: Pool,
  guildRowId: number,
  discordUserId: string
): Promise<EventParticipationSlot[]> {
  const uid = String(discordUserId);
  const slots: EventParticipationSlot[] = [];

  const [kRows] = await pool.query<RowDataPacket[]>(
    `SELECT e.rust_server_id AS sid
     FROM koth_event_members m
     INNER JOIN koth_events e ON e.id = m.event_id
     WHERE e.guild_id = :gid AND e.status IN ('lobby','running')
       AND CAST(m.discord_user_id AS CHAR) = :uid`,
    { gid: guildRowId, uid }
  );
  for (const r of kRows as { sid: number | string }[]) {
    slots.push({ kind: "koth", rustServerId: Number(r.sid) });
  }

  const [mRows] = await pool.query<RowDataPacket[]>(
    `SELECT e.rust_server_id AS sid
     FROM maze_event_members m
     INNER JOIN maze_events e ON e.id = m.event_id
     WHERE e.guild_id = :gid AND e.status IN ('lobby','running')
       AND CAST(m.discord_user_id AS CHAR) = :uid`,
    { gid: guildRowId, uid }
  );
  for (const r of mRows as { sid: number | string }[]) {
    slots.push({ kind: "maze", rustServerId: Number(r.sid) });
  }

  const [nRows] = await pool.query<RowDataPacket[]>(
    `SELECT e.rust_server_id AS sid
     FROM nuketown_event_members m
     INNER JOIN nuketown_events e ON e.id = m.event_id
     WHERE e.guild_id = :gid AND e.status IN ('lobby','running')
       AND CAST(m.discord_user_id AS CHAR) = :uid`,
    { gid: guildRowId, uid }
  );
  for (const r of nRows as { sid: number | string }[]) {
    slots.push({ kind: "nuketown", rustServerId: Number(r.sid) });
  }

  const [oRows] = await pool.query<RowDataPacket[]>(
    `SELECT rust_server_id AS sid FROM one_v_one_matches
     WHERE guild_id = :gid AND status IN ('pending','active')
       AND (CAST(challenger_discord_id AS CHAR) = :uid OR CAST(opponent_discord_id AS CHAR) = :uid)`,
    { gid: guildRowId, uid }
  );
  for (const r of oRows as { sid: number | string }[]) {
    slots.push({ kind: "onev1", rustServerId: Number(r.sid) });
  }

  return slots;
}

/**
 * True if the user cannot join `target` because they are in a different event (including 1v1),
 * or any event when the target is not the exact same roster slot (same kind + same server).
 */
export function joinTargetConflictsWithExistingSlots(
  target: { kind: "koth" | "maze" | "nuketown"; rustServerId: number },
  slots: EventParticipationSlot[]
): boolean {
  for (const s of slots) {
    if (s.kind === "onev1") return true;
    if (s.kind === target.kind && s.rustServerId === target.rustServerId) continue;
    return true;
  }
  return false;
}

export async function discordUserHasAnyActiveEventParticipation(
  pool: Pool,
  guildRowId: number,
  discordUserId: string
): Promise<boolean> {
  const slots = await listActiveEventParticipationSlots(pool, guildRowId, discordUserId);
  return slots.length > 0;
}
