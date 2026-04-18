export type AuthedUser = {
  id: string;
  username: string;
  global_name?: string | null;
  avatar?: string | null;
  email?: string | null;
};

export type MeResponse =
  | { ok: true; user: AuthedUser; exp: number }
  | { ok: false };

export async function fetchMe(): Promise<MeResponse> {
  const res = await fetch("/.netlify/functions/me", { credentials: "include" });
  if (!res.ok) return { ok: false };
  try {
    return (await res.json()) as MeResponse;
  } catch {
    return { ok: false };
  }
}

export function startDiscordLogin(returnTo: string): void {
  const safeReturnTo = returnTo.startsWith("/") ? returnTo : "/";
  window.location.href = `/.netlify/functions/auth-start?returnTo=${encodeURIComponent(safeReturnTo)}`;
}

export async function logout(): Promise<void> {
  await fetch("/.netlify/functions/logout", { method: "POST", credentials: "include" }).catch(() => {});
}

