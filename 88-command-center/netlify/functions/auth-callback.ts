import type { Handler } from "@netlify/functions";
import {
  clearCookie,
  cookieSerialize,
  getAppUrl,
  getDiscordConfig,
  getSessionCookieName,
  getStateCookieName,
  makeSessionJwt,
  parseCookies,
} from "./_shared";

type DiscordTokenResponse = {
  access_token: string;
  token_type: string;
  expires_in: number;
  refresh_token?: string;
  scope: string;
};

type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  email?: string | null;
};

export const handler: Handler = async (event) => {
  const code = event.queryStringParameters?.code;
  const state = event.queryStringParameters?.state;

  if (!code || !state) {
    return { statusCode: 400, body: "Missing code/state." };
  }

  const cookies = parseCookies(event);
  const stateCookieRaw = cookies[getStateCookieName()];
  if (!stateCookieRaw) {
    // Commonly caused by host mismatch (www vs apex) or missing/blocked cookies.
    return {
      statusCode: 400,
      headers: {
        "Cache-Control": "no-store",
        "Content-Type": "text/plain; charset=utf-8",
        "X-Debug-Host": String(event.headers.host ?? ""),
        "X-Debug-Proto": String(event.headers["x-forwarded-proto"] ?? event.headers["X-Forwarded-Proto"] ?? ""),
      },
      body:
        "Missing state cookie.\n\n" +
        "This usually means the OAuth start request set the cookie on a different host (www vs apex), or cookies were blocked.\n" +
        "Check that APP_URL and DISCORD_REDIRECT_URI are on the same host you are browsing.",
    };
  }

  let stateCookie: { state: string; returnTo?: string } | null = null;
  try {
    stateCookie = JSON.parse(stateCookieRaw) as { state: string; returnTo?: string };
  } catch {
    stateCookie = null;
  }

  if (!stateCookie?.state || stateCookie.state !== state) {
    return { statusCode: 400, body: "Invalid state." };
  }

  const { clientId, clientSecret, redirectUri } = getDiscordConfig();

  const tokenRes = await fetch("https://discord.com/api/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      grant_type: "authorization_code",
      code,
      redirect_uri: redirectUri,
    }),
  });

  if (!tokenRes.ok) {
    const t = await tokenRes.text().catch(() => "");
    return { statusCode: 502, body: `Token exchange failed (${tokenRes.status}): ${t}` };
  }

  const tokenJson = (await tokenRes.json()) as DiscordTokenResponse;
  const userRes = await fetch("https://discord.com/api/users/@me", {
    headers: { Authorization: `${tokenJson.token_type} ${tokenJson.access_token}` },
  });

  if (!userRes.ok) {
    const t = await userRes.text().catch(() => "");
    return { statusCode: 502, body: `User fetch failed (${userRes.status}): ${t}` };
  }

  const user = (await userRes.json()) as DiscordUser;

  const jwt = makeSessionJwt(
    {
      sub: user.id,
      username: user.username,
      global_name: user.global_name ?? null,
      avatar: user.avatar ?? null,
      email: user.email ?? null,
    },
    7 * 24 * 60 * 60
  );

  const sessionCookie = cookieSerialize(event, getSessionCookieName(), jwt, {
    maxAgeSeconds: 7 * 24 * 60 * 60,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });

  const clearState = clearCookie(event, getStateCookieName());
  const appUrl = getAppUrl();
  const returnTo = (stateCookie.returnTo && stateCookie.returnTo.startsWith("/") ? stateCookie.returnTo : "/") ?? "/";

  return {
    statusCode: 302,
    headers: {
      Location: `${appUrl}${returnTo}`,
      "Cache-Control": "no-store",
    },
    // Netlify runtime expects multi-value headers for multiple Set-Cookie values
    multiValueHeaders: {
      "Set-Cookie": [sessionCookie, clearState],
    },
    body: "",
  };
};

