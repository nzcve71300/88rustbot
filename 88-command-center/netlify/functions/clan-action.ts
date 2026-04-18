import type { Handler } from "@netlify/functions";
import { getSessionCookieName, parseCookies, verifySessionJwt } from "./_shared";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

export const handler: Handler = async (event) => {
  try {
    const serverId = Number.parseInt(event.queryStringParameters?.serverId ?? "", 10);
    const action = String(event.queryStringParameters?.action ?? "").trim();
    if (!Number.isFinite(serverId) || serverId < 1) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing serverId" }) };
    }
    if (!action) return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing action" }) };

    const cookies = parseCookies(event);
    const token = cookies[getSessionCookieName()];
    if (!token) return { statusCode: 401, body: JSON.stringify({ ok: false }) };
    const claims = verifySessionJwt(token);
    if (!claims) return { statusCode: 401, body: JSON.stringify({ ok: false }) };

    const botApiUrl = requireEnv("BOT_API_URL").replace(/\/+$/, "");
    const botApiKey = requireEnv("BOT_API_KEY");

    const method = event.httpMethod || "POST";
    const upstream = await fetch(`${botApiUrl}/api/server/${serverId}/clan/${encodeURIComponent(action)}`, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Api-Key": botApiKey,
        "X-Discord-User-Id": claims.sub,
      },
      body: method === "GET" ? undefined : event.body ?? "{}",
    });
    const text = await upstream.text();
    return { statusCode: upstream.status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" }, body: text };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { statusCode: 500, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false, error: msg }) };
  }
};

