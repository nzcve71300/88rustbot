import type { Pool, ResultSetHeader, RowDataPacket } from "mysql2/promise";

export type ClanSettings = {
  enabled: boolean;
  maxMembers: number;
  channelId: string | null;
  messageId: string | null;
};

export async function upsertClanSettings(
  pool: Pool,
  guildRowId: number,
  enabled: boolean,
  maxMembers: number,
  channelId: string | null,
  messageId: string | null
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `
    INSERT INTO clan_settings (guild_id, enabled, max_members, channel_id, message_id)
    VALUES (:gid, :enabled, :maxMembers, :channelId, :messageId)
    ON DUPLICATE KEY UPDATE
      enabled = VALUES(enabled),
      max_members = VALUES(max_members),
      channel_id = VALUES(channel_id),
      message_id = VALUES(message_id)
  `,
    {
      gid: guildRowId,
      enabled: enabled ? 1 : 0,
      maxMembers,
      channelId,
      messageId,
    }
  );
}

export async function getClanSettings(pool: Pool, guildRowId: number): Promise<ClanSettings> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT enabled, max_members, channel_id, message_id
     FROM clan_settings WHERE guild_id = :gid LIMIT 1`,
    { gid: guildRowId }
  );
  const r = rows[0] as
    | { enabled: number; max_members: number; channel_id: string | null; message_id: string | null }
    | undefined;
  if (!r) {
    return { enabled: false, maxMembers: 10, channelId: null, messageId: null };
  }
  return {
    enabled: r.enabled === 1,
    maxMembers: Number(r.max_members),
    channelId: r.channel_id,
    messageId: r.message_id,
  };
}

export type InviteLookup = {
  clanId: number;
  clanName: string;
  expiresAt: Date;
  discordRoleId: string | null;
};

export async function findInviteByCode(
  pool: Pool,
  guildRowId: number,
  code: string
): Promise<InviteLookup | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT 
      i.clan_id as clanId,
      c.name as clanName,
      i.expires_at as expiresAt,
      CAST(c.discord_role_id AS CHAR) as discordRoleId
    FROM clan_invites i
    JOIN clans c ON c.id = i.clan_id
    WHERE i.guild_id = :gid AND i.code = :code
    LIMIT 1
  `,
    { gid: guildRowId, code }
  );
  const r = rows[0] as InviteLookup | undefined;
  return r ?? null;
}

export async function countClanMembers(pool: Pool, clanId: number): Promise<number> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT COUNT(*) AS c FROM clan_members WHERE clan_id = :cid",
    { cid: clanId }
  );
  return Number((rows[0] as { c: number }).c);
}

/** All Discord user IDs in a clan (as strings). */
export async function listClanMemberDiscordUserIds(pool: Pool, clanId: number): Promise<string[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT CAST(discord_user_id AS CHAR) AS uid
     FROM clan_members
     WHERE clan_id = :cid
     ORDER BY joined_at ASC`,
    { cid: clanId }
  );
  return (rows as { uid: string }[]).map((r) => String(r.uid));
}

export async function addClanMember(
  pool: Pool,
  clanId: number,
  discordUserId: string
): Promise<"added" | "already_member"> {
  try {
    await pool.query<ResultSetHeader>(
      "INSERT INTO clan_members (clan_id, discord_user_id) VALUES (:cid, :uid)",
      { cid: clanId, uid: discordUserId }
    );
    return "added";
  } catch (e: unknown) {
    const code = typeof e === "object" && e && "code" in e ? String((e as { code: string }).code) : "";
    if (code === "ER_DUP_ENTRY") return "already_member";
    throw e;
  }
}

export type MemberClanInfo = {
  clanId: number;
  clanName: string;
  clanTag: string | null;
  clanColor: string | null;
  ownerDiscordUserId: string | null;
  discordRoleId: string | null;
  discordChannelId: string | null;
};

export async function getMemberClan(
  pool: Pool,
  guildRowId: number,
  discordUserId: string
): Promise<MemberClanInfo | null> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT 
      c.id AS clanId,
      c.name AS clanName,
      c.tag AS clanTag,
      c.color AS clanColor,
      CAST(c.owner_discord_user_id AS CHAR) AS ownerDiscordUserId,
      CAST(c.discord_role_id AS CHAR) AS discordRoleId,
      CAST(c.discord_channel_id AS CHAR) AS discordChannelId
    FROM clan_members m
    JOIN clans c ON c.id = m.clan_id
    WHERE c.guild_id = :gid AND m.discord_user_id = :uid
    LIMIT 1
  `,
    { gid: guildRowId, uid: discordUserId }
  );
  const r = rows[0] as MemberClanInfo | undefined;
  return r ?? null;
}

/** Clan member, or clan owner (for events that allow owners without a member row). */
export async function getClanForEventParticipation(
  pool: Pool,
  guildRowId: number,
  discordUserId: string
): Promise<{ clanId: number; clanName: string } | null> {
  const member = await getMemberClan(pool, guildRowId, discordUserId);
  if (member) return { clanId: member.clanId, clanName: member.clanName };
  const [rows] = await pool.query<RowDataPacket[]>(
    `SELECT id AS clanId, name AS clanName FROM clans
     WHERE guild_id = :gid AND CAST(owner_discord_user_id AS CHAR) = :uid LIMIT 1`,
    { gid: guildRowId, uid: String(discordUserId) }
  );
  const r = rows[0] as { clanId: number; clanName: string } | undefined;
  return r ? { clanId: Number(r.clanId), clanName: String(r.clanName) } : null;
}

export type CreateClanInput = {
  name: string;
  tag: string;
  color: string;
  ownerDiscordUserId: string;
  discordRoleId: string;
  discordChannelId: string;
};

export async function createClan(
  pool: Pool,
  guildRowId: number,
  input: CreateClanInput
): Promise<{ clanId: number }> {
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    const [res] = await conn.query<ResultSetHeader>(
      `
      INSERT INTO clans (guild_id, name, tag, color, owner_discord_user_id, discord_role_id, discord_channel_id)
      VALUES (:gid, :name, :tag, :color, :owner, :roleId, :channelId)
    `,
      {
        gid: guildRowId,
        name: input.name,
        tag: input.tag,
        color: input.color,
        owner: input.ownerDiscordUserId,
        roleId: input.discordRoleId,
        channelId: input.discordChannelId,
      }
    );
    const clanId = Number(res.insertId);

    await conn.query<ResultSetHeader>(
      "INSERT INTO clan_members (clan_id, discord_user_id) VALUES (:cid, :uid)",
      { cid: clanId, uid: input.ownerDiscordUserId }
    );

    await conn.commit();
    return { clanId };
  } catch (e) {
    try {
      await conn.rollback();
    } catch {
      /* ignore */
    }
    throw e;
  } finally {
    conn.release();
  }
}

export async function deleteClan(pool: Pool, guildRowId: number, clanId: number): Promise<void> {
  await pool.query<ResultSetHeader>(
    "DELETE FROM clans WHERE id = :cid AND guild_id = :gid",
    { cid: clanId, gid: guildRowId }
  );
}

export async function removeClanMember(
  pool: Pool,
  clanId: number,
  discordUserId: string
): Promise<boolean> {
  const [res] = await pool.query<ResultSetHeader>(
    "DELETE FROM clan_members WHERE clan_id = :cid AND discord_user_id = :uid",
    { cid: clanId, uid: discordUserId }
  );
  return res.affectedRows > 0;
}

export async function promoteClanOwner(
  pool: Pool,
  guildRowId: number,
  clanId: number,
  newOwnerDiscordUserId: string
): Promise<void> {
  await pool.query<ResultSetHeader>(
    "UPDATE clans SET owner_discord_user_id = :uid WHERE id = :cid AND guild_id = :gid",
    { uid: newOwnerDiscordUserId, cid: clanId, gid: guildRowId }
  );
}

export async function inviteCodeExists(
  pool: Pool,
  guildRowId: number,
  code: string
): Promise<boolean> {
  const [rows] = await pool.query<RowDataPacket[]>(
    "SELECT 1 AS ok FROM clan_invites WHERE guild_id = :gid AND code = :code LIMIT 1",
    { gid: guildRowId, code }
  );
  return rows.length > 0;
}

export async function createInvite(
  pool: Pool,
  guildRowId: number,
  clanId: number,
  code: string,
  expiresAt: Date
): Promise<void> {
  await pool.query<ResultSetHeader>(
    `
    INSERT INTO clan_invites (guild_id, clan_id, code, expires_at)
    VALUES (:gid, :cid, :code, :exp)
  `,
    { gid: guildRowId, cid: clanId, code, exp: expiresAt }
  );
}

export async function deleteExpiredInvites(pool: Pool): Promise<number> {
  const [res] = await pool.query<ResultSetHeader>(
    "DELETE FROM clan_invites WHERE expires_at <= NOW()"
  );
  return res.affectedRows;
}

export type GuildClanListRow = {
  clanName: string;
  clanTag: string | null;
  memberCount: number;
};

/**
 * All clans in a Discord guild with member counts (clans are guild-scoped; there is no per–Rust-server clan row).
 * Ordered by clan name.
 */
export async function listGuildClansWithMemberCounts(
  pool: Pool,
  guildRowId: number
): Promise<GuildClanListRow[]> {
  const [rows] = await pool.query<RowDataPacket[]>(
    `
    SELECT
      c.name AS clanName,
      c.tag AS clanTag,
      COUNT(cm.discord_user_id) AS memberCount
    FROM clans c
    LEFT JOIN clan_members cm ON cm.clan_id = c.id
    WHERE c.guild_id = :gid
    GROUP BY c.id, c.name, c.tag
    ORDER BY c.name ASC
    `,
    { gid: guildRowId }
  );
  return rows.map((r) => ({
    clanName: String((r as { clanName: unknown }).clanName ?? ""),
    clanTag: (r as { clanTag: unknown }).clanTag != null ? String((r as { clanTag: unknown }).clanTag) : null,
    memberCount: Number((r as { memberCount: unknown }).memberCount ?? 0),
  }));
}

