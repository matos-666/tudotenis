/**
 * ELO win probability formula (Arpad Elo, 1960).
 * P1 wins vs P2 = 1 / (1 + 10^((elo2 - elo1) / 400))
 */
export function eloProb(elo1: number, elo2: number): number {
  return 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
}

/**
 * Fair odds from probability (1/p).
 */
export function fairOdds(p: number): number {
  return 1 / p;
}

/**
 * Match slug helper: ordena alfabeticamente para evitar duplicação
 * (sinner-alcaraz === alcaraz-sinner === "alcaraz-sinner")
 */
export function buildMatchupSlug(slugA: string, slugB: string): string {
  return [slugA, slugB].sort().join('-');
}

/**
 * Parse "alcaraz-sinner" → ["alcaraz", "sinner"]
 * Need to be careful: some slugs have hyphens (e.g. "felix-auger-aliassime").
 * Strategy: try every split point and check if both halves are valid slugs.
 */
export function parseMatchupSlug(
  matchup: string,
  knownSlugs: Set<string>
): [string, string] | null {
  const parts = matchup.split('-');
  for (let i = 1; i < parts.length; i++) {
    const a = parts.slice(0, i).join('-');
    const b = parts.slice(i).join('-');
    if (knownSlugs.has(a) && knownSlugs.has(b)) {
      return [a, b].sort() as [string, string];
    }
  }
  return null;
}
