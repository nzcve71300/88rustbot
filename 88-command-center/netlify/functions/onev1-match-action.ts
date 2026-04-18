import type { Handler } from "@netlify/functions";
import { getSessionCookieName, parseCookies, verifySessionJwt } from "./_shared";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "POST") {
      return { statusCode: 405, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false }) };
    }

    const serverId = Number.parseInt(event.queryStringParameters?.serverId ?? "", 10);
    const matchId = Number.parseInt(event.queryStringParameters?.matchId ?? "", 10);
    const action = String(event.queryStringParameters?.action ?? "").trim().toLowerCase();

    if (!Number.isFinite(serverId) || serverId < 1 || !Number.isFinite(matchId) || matchId < 1) {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Missing serverId or matchId" }) };
    }
    if (action !== "accept" && action !== "duck") {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Invalid action" }) };
    }

    const cookies = parseCookies(event);
    const token = cookies[getSessionCookieName()];
    if (!token) return { statusCode: 401, body: JSON.stringify({ ok: false }) };
    const claims = verifySessionJwt(token);
    if (!claims) return { statusCode: 401, body: JSON.stringify({ ok: false }) };

    const botApiUrl = requireEnv("BOT_API_URL").replace(/\/+$/, "");
    const botApiKey = requireEnv("BOT_API_KEY");

    let upstream: Response;
    try {
      upstream = await fetch(
        `${botApiUrl}/api/server/${serverId}/onev1/match/${matchId}/${action}`,
        {
          method: "POST",
          headers: { "X-Api-Key": botApiKey, "X-Discord-User-Id": claims.sub, "Content-Type": "application/json" },
          body: "{}",
        }
      );
    } catch (err) {
      console.error("[onev1-match-action fn] fetch failed:", err);
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ ok: false, error: "Upstream fetch failed" }),
      };
    }

    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: text,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[onev1-match-action fn] error:", msg);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: false, error: msg }),
    };
  }
};
