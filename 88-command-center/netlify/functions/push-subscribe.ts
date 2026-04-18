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

    const serverIdRaw = event.queryStringParameters?.serverId;
    const serverId =
      serverIdRaw != null && String(serverIdRaw).trim() !== ""
        ? Number.parseInt(String(serverIdRaw), 10)
        : Number.NaN;

    const cookies = parseCookies(event);
    const token = cookies[getSessionCookieName()];
    if (!token) return { statusCode: 401, body: JSON.stringify({ ok: false }) };
    const claims = verifySessionJwt(token);
    if (!claims) return { statusCode: 401, body: JSON.stringify({ ok: false }) };

    const botApiUrl = requireEnv("BOT_API_URL").replace(/\/+$/, "");
    const botApiKey = requireEnv("BOT_API_KEY");

    const rawBody = event.body ?? "{}";
    let subscription: unknown;
    try {
      subscription = JSON.parse(rawBody);
    } catch {
      return { statusCode: 400, body: JSON.stringify({ ok: false, error: "Invalid JSON" }) };
    }

    const payload: Record<string, unknown> = { subscription };
    if (Number.isFinite(serverId) && serverId >= 1) {
      payload.serverId = serverId;
    }

    let upstream: Response;
    try {
      upstream = await fetch(`${botApiUrl}/api/push/subscribe`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Api-Key": botApiKey,
          "X-Discord-User-Id": claims.sub,
        },
        body: JSON.stringify(payload),
      });
    } catch (err) {
      console.error("[push-subscribe fn] fetch failed:", err);
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ ok: false, error: "Upstream fetch failed" }),
      };
    }

    const text = await upstream.text();
    if (!upstream.ok) {
      console.error("[push-subscribe fn] upstream error", { status: upstream.status, bodyPreview: text.slice(0, 500) });
    }
    return {
      statusCode: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: text,
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[push-subscribe fn] error:", msg);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: false, error: msg }),
    };
  }
};
