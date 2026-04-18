import type { Handler } from "@netlify/functions";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v?.trim()) throw new Error(`Missing env var: ${name}`);
  return v.trim();
}

export const handler: Handler = async (event) => {
  try {
    if (event.httpMethod !== "GET") {
      return { statusCode: 405, headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ok: false }) };
    }
    const publicKey = requireEnv("VAPID_PUBLIC_KEY");
    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=3600" },
      body: JSON.stringify({ ok: true, publicKey }),
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[push-vapid-public fn] error:", msg);
    return {
      statusCode: 503,
      headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
      body: JSON.stringify({ ok: false, error: "Push not configured." }),
    };
  }
};
