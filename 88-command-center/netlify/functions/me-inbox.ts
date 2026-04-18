import type { Handler } from "@netlify/functions";
import { getSessionCookieName, parseCookies, verifySessionJwt } from "./_shared";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

export const handler: Handler = async (event) => {
  try {
    const cookies = parseCookies(event);
    const token = cookies[getSessionCookieName()];
    if (!token) {
      return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false }) };
    }
    const claims = verifySessionJwt(token);
    if (!claims) {
      return { statusCode: 401, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false }) };
    }

    const botApiUrl = requireEnv("BOT_API_URL").replace(/\/+$/, "");
    const botApiKey = requireEnv("BOT_API_KEY");

    if (event.httpMethod === "GET") {
      let upstream: Response;
      try {
        upstream = await fetch(`${botApiUrl}/api/me/inbox`, {
          headers: { "X-Api-Key": botApiKey, "X-Discord-User-Id": claims.sub },
        });
      } catch (err) {
        console.error("[me-inbox fn] fetch failed:", err);
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
    }

    if (event.httpMethod === "POST") {
      let body = "{}";
      try {
        body = event.body && event.isBase64Encoded ? Buffer.from(event.body, "base64").toString("utf8") : event.body ?? "{}";
      } catch {
        body = "{}";
      }
      let upstream: Response;
      try {
        upstream = await fetch(`${botApiUrl}/api/me/inbox/mark-read`, {
          method: "POST",
          headers: {
            "X-Api-Key": botApiKey,
            "X-Discord-User-Id": claims.sub,
            "Content-Type": "application/json",
          },
          body,
        });
      } catch (err) {
        console.error("[me-inbox fn] mark-read fetch failed:", err);
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
    }

    return { statusCode: 405, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false }) };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[me-inbox fn] error:", msg);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: false, error: msg }),
    };
  }
};
