import type { Handler } from "@netlify/functions";
import { clearCookie, getSessionCookieName } from "./_shared";

export const handler: Handler = async (event) => {
  return {
    statusCode: 200,
    headers: {
      "Set-Cookie": clearCookie(event, getSessionCookieName()),
      "Cache-Control": "no-store",
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ ok: true }),
  };
};

