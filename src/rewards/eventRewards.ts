import type { Pool } from "mysql2/promise";
import { updateLucidsByDelta } from "../db/storeLucids.js";
import { listClanMemberDiscordUserIds } from "../db/clans.js";

export async function rewardClanLucids(pool: Pool, clanId: number, amount: number): Promise<{ members: number }> {
  const amt = Math.max(0, Math.floor(amount));
  if (amt <= 0) return { members: 0 };
  const ids = await listClanMemberDiscordUserIds(pool, clanId);
  await Promise.all(
    ids.map(async (id) => {
      try {
        await updateLucidsByDelta(pool, id, amt);
      } catch (e) {
        console.error("[rewards] failed to update lucids for user", id, e);
      }
    })
  );
  return { members: ids.length };
}

export async function rewardPlayerLucids(pool: Pool, discordUserId: string, amount: number): Promise<void> {
  const amt = Math.max(0, Math.floor(amount));
  if (amt <= 0) return;
  await updateLucidsByDelta(pool, discordUserId, amt);
}

