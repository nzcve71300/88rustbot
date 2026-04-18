import type { Handler } from "@netlify/functions";
import { cookieSerialize, getAppUrl, getDiscordConfig, getStateCookieName, makeOauthState } from "./_shared";

function buildAuthorizeUrl(params: Record<string, string>): string {
  const u = new URL("https://discord.com/oauth2/authorize");
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
}

export const handler: Handler = async (event) => {
  const { clientId, redirectUri } = getDiscordConfig();
  const state = makeOauthState();

  const returnToRaw = event.queryStringParameters?.returnTo ?? "/";
  // prevent open-redirects: only allow same-origin paths
  const returnTo = returnToRaw.startsWith("/") ? returnToRaw : "/";

  const authorizeUrl = buildAuthorizeUrl({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "identify email",
    state,
  });

  const appUrl = getAppUrl();
  const stateCookie = cookieSerialize(event, getStateCookieName(), JSON.stringify({ state, returnTo }), {
    maxAgeSeconds: 10 * 60,
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
  });

  return {
    statusCode: 302,
    headers: {
      Location: authorizeUrl,
      "Cache-Control": "no-store",
      "Set-Cookie": stateCookie,
      // helpful for debugging where callback should land
      "X-App-Url": appUrl,
    },
    body: "",
  };
};

