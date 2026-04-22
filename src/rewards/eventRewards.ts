import type { Pool } from "mysql2/promise";
import { updateLucidsByDelta } from "../db/storeLucids.js";

export async function rewardDiscordUsersLucids(
  pool: Pool,
  discordUserIds: string[],
  amount: number
): Promise<{ members: number }> {
  const amt = Math.max(0, Math.floor(amount));
  if (amt <= 0) return { members: 0 };
  await Promise.all(
    discordUserIds.map(async (id) => {
      try {
        await updateLucidsByDelta(pool, id, amt);
      } catch (e) {
        console.error("[rewards] failed to update lucids for user", id, e);
      }
    })
  );
  return { members: discordUserIds.length };
}

export async function rewardPlayerLucids(pool: Pool, discordUserId: string, amount: number): Promise<void> {
  const amt = Math.max(0, Math.floor(amount));
  if (amt <= 0) return;
  await updateLucidsByDelta(pool, discordUserId, amt);
}

