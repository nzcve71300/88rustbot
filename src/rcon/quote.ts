/** Escape a string for use inside Rust RCON double-quoted arguments. */
export function quoteForRconArg(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
