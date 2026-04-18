import type { Handler } from "@netlify/functions";
import { getSessionCookieName, parseCookies, verifySessionJwt } from "./_shared";

export const handler: Handler = async (event) => {
  const cookies = parseCookies(event);
  const token = cookies[getSessionCookieName()];
  if (!token) {
    return { statusCode: 401, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ ok: false }) };
  }

  const claims = verifySessionJwt(token);
  if (!claims) {
    return { statusCode: 401, headers: { "Cache-Control": "no-store" }, body: JSON.stringify({ ok: false }) };
  }

  return {
    statusCode: 200,
    headers: { "Content-Type": "application/json", "Cache-Control": "no-store" },
    body: JSON.stringify({
      ok: true,
      user: {
        id: claims.sub,
        username: claims.username,
        global_name: claims.global_name ?? null,
        avatar: claims.avatar ?? null,
        email: claims.email ?? null,
      },
      exp: claims.exp,
    }),
  };
};

