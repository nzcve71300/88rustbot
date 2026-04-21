/** KD for display: kills/deaths ratio, or kills as string when deaths is 0. */
export function formatKdRatio(kills: number, deaths: number): string {
  const k = Number(kills) || 0;
  const d = Number(deaths) || 0;
  if (d > 0) return (k / d).toFixed(2);
  return String(k);
}
