import type { Handler } from "@netlify/functions";
import { getSessionCookieName, parseCookies, verifySessionJwt } from "./_shared";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

/**
 * Proxies authenticated website users to the bot admin API (`/api/admin/*`).
 * Requires session cookie + sends `X-Discord-User-Id` + `X-Api-Key` upstream.
 *
 * Pass the bot path in header `X-Admin-Path` (e.g. `/api/admin/eligible`) or query `?p=/api/admin/eligible`.
 */
export const handler: Handler = async (event) => {
  try {
    const cookies = parseCookies(event);
    const token = cookies[getSessionCookieName()];
    if (!token) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ ok: false, error: "Not logged in" }),
      };
    }
    const claims = verifySessionJwt(token);
    if (!claims) {
      return {
        statusCode: 401,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ ok: false, error: "Invalid session" }),
      };
    }

    const fromHeader = String(event.headers["x-admin-path"] ?? event.headers["X-Admin-Path"] ?? "").trim();
    const fromQuery = String(event.queryStringParameters?.p ?? "").trim();
    const adminPath = fromHeader || fromQuery;
    if (!adminPath.startsWith("/api/admin/")) {
      return {
        statusCode: 400,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ ok: false, error: "Missing or invalid admin path" }),
      };
    }

    const botApiUrl = requireEnv("BOT_API_URL").replace(/\/+$/, "");
    const botApiKey = requireEnv("BOT_API_KEY");
    const method = (event.httpMethod ?? "GET").toUpperCase();

    const upstream = await fetch(`${botApiUrl}${adminPath}`, {
      method,
      headers: {
        "X-Api-Key": botApiKey,
        "X-Discord-User-Id": claims.sub,
        ...(method !== "GET" && method !== "HEAD" ? { "Content-Type": "application/json" } : {}),
      },
      body: method !== "GET" && method !== "HEAD" && event.body ? event.body : undefined,
    });

    const text = await upstream.text();
    return {
      statusCode: upstream.status,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: text,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("[admin-gateway]", msg);
    return {
      statusCode: 502,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: false, error: msg }),
    };
  }
};
