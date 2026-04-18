import type { HandlerEvent } from "@netlify/functions";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export type DiscordUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  email?: string | null;
};

type SessionClaims = {
  sub: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  email?: string | null;
  exp: number; // seconds
};

const SESSION_COOKIE = "cc_session";
const STATE_COOKIE = "cc_oauth_state";

function getEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var: ${name}`);
  return v;
}

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

function base64urlJson(obj: unknown): string {
  return base64url(Buffer.from(JSON.stringify(obj), "utf8"));
}

function parseBase64urlJson<T>(s: string): T {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4);
  const raw = Buffer.from(padded, "base64").toString("utf8");
  return JSON.parse(raw) as T;
}

function signHs256(unsigned: string, secret: string): string {
  const sig = createHmac("sha256", secret).update(unsigned).digest();
  return base64url(sig);
}

export function makeSessionJwt(claims: Omit<SessionClaims, "exp">, ttlSeconds: number): string {
  const header = { alg: "HS256", typ: "JWT" };
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  const payload: SessionClaims = { ...claims, exp };
  const unsigned = `${base64urlJson(header)}.${base64urlJson(payload)}`;
  const secret = getEnv("SESSION_SECRET");
  return `${unsigned}.${signHs256(unsigned, secret)}`;
}

export function verifySessionJwt(token: string): SessionClaims | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [h, p, sig] = parts;
  const unsigned = `${h}.${p}`;
  const secret = getEnv("SESSION_SECRET");
  const expected = signHs256(unsigned, secret);

  try {
    const a = Buffer.from(sig);
    const b = Buffer.from(expected);
    if (a.length !== b.length) return null;
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  const payload = parseBase64urlJson<SessionClaims>(p);
  if (typeof payload.exp !== "number") return null;
  if (payload.exp <= Math.floor(Date.now() / 1000)) return null;
  return payload;
}

export function parseCookies(event: HandlerEvent): Record<string, string> {
  const header =
    event.headers.cookie ??
    // multiValueHeaders can exist depending on adapter/runtime
    (event.multiValueHeaders?.cookie ? event.multiValueHeaders.cookie.join("; ") : undefined);

  if (!header) return {};
  const out: Record<string, string> = {};
  const parts = header.split(";").map((p) => p.trim()).filter(Boolean);
  for (const part of parts) {
    const i = part.indexOf("=");
    if (i < 0) continue;
    const k = part.slice(0, i).trim();
    const v = part.slice(i + 1).trim();
    out[k] = decodeURIComponent(v);
  }
  return out;
}

function isHttps(event: HandlerEvent): boolean {
  const xfProto = (event.headers["x-forwarded-proto"] ?? event.headers["X-Forwarded-Proto"]) as string | undefined;
  return (xfProto ?? "").toLowerCase() === "https";
}

function getCookieDomainFromAppUrl(): string | null {
  // Ensures OAuth state/session cookies survive redirects between www/apex.
  // If APP_URL is https://grindset.site -> Domain=.grindset.site
  // If APP_URL is a platform subdomain, it still works as expected.
  try {
    const u = new URL(getAppUrl());
    const host = u.hostname;
    if (!host || host === "localhost" || host === "127.0.0.1") return null;
    // Leading dot allows sharing across subdomains (www <-> apex).
    return host.startsWith(".") ? host : `.${host}`;
  } catch {
    return null;
  }
}

export function cookieSerialize(
  event: HandlerEvent,
  name: string,
  value: string,
  opts: {
    maxAgeSeconds?: number;
    httpOnly?: boolean;
    sameSite?: "Lax" | "Strict" | "None";
    path?: string;
    domain?: string;
  }
): string {
  const parts: string[] = [];
  parts.push(`${name}=${encodeURIComponent(value)}`);
  parts.push(`Path=${opts.path ?? "/"}`);
  const domain = opts.domain ?? getCookieDomainFromAppUrl();
  if (domain) parts.push(`Domain=${domain}`);
  if (opts.maxAgeSeconds !== undefined) parts.push(`Max-Age=${opts.maxAgeSeconds}`);
  if (opts.httpOnly !== false) parts.push("HttpOnly");
  parts.push(`SameSite=${opts.sameSite ?? "Lax"}`);
  if (isHttps(event)) parts.push("Secure");
  return parts.join("; ");
}

export function clearCookie(event: HandlerEvent, name: string): string {
  return cookieSerialize(event, name, "", { maxAgeSeconds: 0 });
}

export function makeOauthState(): string {
  return base64url(randomBytes(24));
}

export function getSessionCookieName(): string {
  return SESSION_COOKIE;
}

export function getStateCookieName(): string {
  return STATE_COOKIE;
}

export function getAppUrl(): string {
  return getEnv("APP_URL").replace(/\/+$/, "");
}

export function getDiscordConfig(): { clientId: string; clientSecret: string; redirectUri: string } {
  return {
    clientId: getEnv("DISCORD_CLIENT_ID"),
    clientSecret: getEnv("DISCORD_CLIENT_SECRET"),
    redirectUri: getEnv("DISCORD_REDIRECT_URI"),
  };
}

