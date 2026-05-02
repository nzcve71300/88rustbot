import type { Pool } from "mysql2/promise";
import { config } from "../config.js";
import { decryptSecret } from "../crypto/passwordVault.js";
import { getEventZoneConfig } from "../db/eventZones.js";
import { getRustServerByIdForGuild } from "../db/rustServers.js";
import { applyEventZoneConfigIfPresent } from "../zones/eventZones.js";

/**
 * When a KOTH lobby exists, the main event zone should be **active** (not inactive).
 * Call from `/koth-join`, website join, and automation when a lobby opens — not only on Discord command.
 */
export async function applyKothLobbyActiveZoneIfConfigured(
  pool: Pool,
  guildRowId: number,
  rustServerId: number
): Promise<void> {
  const zoneRow = await getEventZoneConfig(pool, guildRowId, rustServerId, "koth", "active");
  if (!zoneRow) {
    console.warn(
      `[koth zones] No saved **active** KOTH zone for rust_server_id=${rustServerId} — set it in Command Center (Event Zone Editor) or the lobby arena will not switch.`
    );
    return;
  }
  const srv = await getRustServerByIdForGuild(pool, guildRowId, rustServerId);
  if (!srv) return;
  let password: string;
  try {
    password = decryptSecret(srv.rcon_password_encrypted, config.encryptionKeyHex);
  } catch {
    return;
  }
  await applyEventZoneConfigIfPresent({
    pool,
    guildRowId,
    rustServerId,
    eventType: "koth",
    desired: "active",
    rcon: { host: srv.server_ip, port: srv.rcon_port, password },
  });
}
