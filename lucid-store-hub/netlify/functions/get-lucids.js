// Netlify Function: Proxy Lucids balance from Hetzner event-bot API.
// The API key stays server-side in Netlify env vars.
//
// Required Netlify env vars:
// - EVENT_BOT_API_BASE_URL   e.g. https://your-hetzner-domain.com:PORT  (no trailing slash)
// - EVENT_BOT_API_KEY        must match BOT_API_KEY on the Hetzner bot

function json(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-store",
    },
    body: JSON.stringify(body),
  };
}

exports.handler = async (event) => {
  if (event.httpMethod !== "GET") {
    return json(405, { ok: false, error: "Method Not Allowed" });
  }

  const discordId = String(event.queryStringParameters?.discordId || "").trim();
  if (!discordId) {
    return json(400, { ok: false, error: "Missing discordId" });
  }

  const base = String(process.env.EVENT_BOT_API_BASE_URL || "").trim().replace(/\/+$/, "");
  const key = String(process.env.EVENT_BOT_API_KEY || "").trim();
  if (!base || !key) {
    return json(503, { ok: false, error: "Lucids API not configured" });
  }

  try {
    const res = await fetch(`${base}/api/me/lucids`, {
      method: "GET",
      headers: {
        "x-api-key": key,
        "x-discord-user-id": discordId,
      },
    });

    const text = await res.text();
    let data = null;
    try {
      data = JSON.parse(text);
    } catch {
      data = { ok: false, error: "Invalid upstream response", raw: text };
    }

    if (!res.ok || !data?.ok) {
      return json(res.status || 502, {
        ok: false,
        error: "Upstream error",
        upstream: data,
      });
    }

    const lucids = typeof data.lucids === "string" ? parseInt(data.lucids, 10) : Number(data.lucids || 0);
    return json(200, { ok: true, discordId, lucids: Number.isFinite(lucids) ? Math.max(0, Math.floor(lucids)) : 0 });
  } catch (err) {
    return json(500, { ok: false, error: "Failed to fetch Lucids", message: err?.message || String(err) });
  }
};

