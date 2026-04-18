import type { Handler } from "@netlify/functions";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

export const handler: Handler = async () => {
  try {
    const botApiUrl = requireEnv("BOT_API_URL").replace(/\/+$/, "");
    const botApiKey = requireEnv("BOT_API_KEY");

    // Quick connectivity check to make failures obvious (DNS/tunnel/SSL).
    const health = await fetch(`${botApiUrl}/health`).catch((err) => {
      throw new Error(`Failed to reach BOT_API_URL /health: ${err instanceof Error ? err.message : String(err)}`);
    });
    if (!health.ok) {
      const t = await health.text().catch(() => "");
      throw new Error(`BOT_API_URL /health returned ${health.status}: ${t.slice(0, 300)}`);
    }

    const upstream = await fetch(`${botApiUrl}/api/servers`, {
      headers: { "X-Api-Key": botApiKey },
    });
    const text = await upstream.text();
    if (!upstream.ok) {
      console.error("[servers fn] upstream error", {
        status: upstream.status,
        bodyPreview: text.slice(0, 800),
      });
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({ ok: false, error: `Upstream error ${upstream.status}`, upstream: text }),
      };
    }

    let parsed: { ok: boolean; servers?: unknown[] };
    try {
      parsed = JSON.parse(text) as { ok: boolean; servers?: unknown[] };
    } catch (err) {
      console.error("[servers fn] upstream returned non-JSON", { bodyPreview: text.slice(0, 800) });
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
        body: JSON.stringify({
          ok: false,
          error: "Upstream returned non-JSON",
          hint: "Check BOT_API_URL points to your bot API (should return JSON on /api/servers).",
          upstreamPreview: text.slice(0, 800),
        }),
      };
    }
    const results = parsed.servers ?? [];
    return {
      statusCode: 200,
      // Let the CDN cache briefly; bot API also caches.
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=5, s-maxage=15, stale-while-revalidate=60",
      },
      body: JSON.stringify({ servers: results }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[servers fn] error", msg);
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({
        ok: false,
        error: msg,
        hint:
          "Check Netlify environment variables: BOT_API_URL and BOT_API_KEY (this function proxies to your bot-hosted API).",
      }),
    };
  }
};

