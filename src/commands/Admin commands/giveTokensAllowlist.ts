/** Same allowlist as `/give-tokens`. Keep in one place. */
const GIVE_TOKENS_ALLOWLIST = new Set<string>([
  "1252993829007528086",
  "1445388567927853068",
  "382851787654168588",
  "1393246741226061935",
]);

export function canUseGiveTokens(actorDiscordUserId: string | undefined): boolean {
  return !!actorDiscordUserId && GIVE_TOKENS_ALLOWLIST.has(actorDiscordUserId);
}
