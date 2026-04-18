import webpush from "web-push";
import type { Pool } from "mysql2/promise";
import {
  deleteWebPushSubscription,
  listWebPushSubscriptionsForDiscordUserGuildServer,
  listWebPushSubscriptionsForGuildAndServer,
  type WebPushRow,
} from "../db/webPush.js";

let configured = false;
let warnedMissingVapid = false;

function ensureConfigured(): boolean {
  if (configured) return true;
  const pub = process.env.VAPID_PUBLIC_KEY?.trim();
  const priv = process.env.VAPID_PRIVATE_KEY?.trim();
  const subject = process.env.VAPID_SUBJECT?.trim() || "mailto:admin@localhost";
  if (!pub || !priv) {
    if (!warnedMissingVapid) {
      warnedMissingVapid = true;
      console.warn(
        "[web-push] VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY not set on the bot process — web push is disabled. Add them to the bot .env and restart."
      );
    }
    return false;
  }
  webpush.setVapidDetails(subject, pub, priv);
  configured = true;
  return true;
}

async function sendWebPushToRows(
  pool: Pool,
  rows: WebPushRow[],
  payload: { title: string; body: string; url?: string; tag?: string },
  logLabel: string
): Promise<void> {
  const baseUrl = process.env.COMMAND_CENTER_APP_URL?.replace(/\/+$/, "") ?? "";
  const fallbackUrl = baseUrl ? `${baseUrl}/servers` : undefined;
  const url = payload.url ?? fallbackUrl;
  const data = JSON.stringify({
    title: payload.title,
    body: payload.body,
    url,
    tag: payload.tag ?? "grindset-event",
  });

  console.log(`[web-push] ${logLabel} endpoints=${rows.length}`);

  for (const row of rows) {
    try {
      await webpush.sendNotification(
        { endpoint: row.endpoint, keys: { p256dh: row.p256dh, auth: row.auth } },
        data,
        {
          TTL: 120,
          // Web Push Protocol: high urgency helps delivery on Android (FCM) and other stacks.
          urgency: "high",
        }
      );
    } catch (e: unknown) {
      const status =
        typeof e === "object" && e && "statusCode" in e ? Number((e as { statusCode: number }).statusCode) : 0;
      if (status === 404 || status === 410) {
        await deleteWebPushSubscription(pool, row.discordUserId, row.endpoint).catch(() => {});
      }
      console.error("[web-push] send failed:", e);
    }
  }
}

export async function notifyGuildWebPush(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  payload: { title: string; body: string; url?: string; tag?: string }
): Promise<void> {
  if (!ensureConfigured()) return;
  const rows = await listWebPushSubscriptionsForGuildAndServer(pool, guildRowId, rustServerId);
  console.log(
    `[web-push] ${payload.tag ?? "event"} guildRow=${guildRowId} rustServer=${rustServerId} subscribers=${rows.length}`
  );
  if (rows.length === 0) return;
  await sendWebPushToRows(pool, rows, payload, payload.tag ?? "broadcast");
}

/** Send a push notification to a single Discord user (all their endpoints scoped to this server). */
export async function notifyDiscordUserWebPushForGuildServer(
  pool: Pool,
  guildRowId: number,
  rustServerId: number,
  discordUserId: string,
  payload: { title: string; body: string; url?: string; tag?: string }
): Promise<void> {
  if (!ensureConfigured()) return;
  const rows = await listWebPushSubscriptionsForDiscordUserGuildServer(
    pool,
    guildRowId,
    rustServerId,
    discordUserId
  );
  if (rows.length === 0) {
    console.log(
      `[web-push] user-target skip guildRow=${guildRowId} rustServer=${rustServerId} user=${discordUserId} (no subscription or out of scope)`
    );
    return;
  }
  await sendWebPushToRows(pool, rows, payload, `user ${discordUserId} ${payload.tag ?? "notify"}`);
}
