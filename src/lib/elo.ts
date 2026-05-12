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
 * Formato SEO-friendly: "slug1-vs-slug2"
 * (sinner-vs-alcaraz === alcaraz-vs-sinner → "alcaraz-vs-sinner")
 */
export function buildMatchupSlug(slugA: string, slugB: string): string {
  return [slugA, slugB].sort().join('-vs-');
}

/**
 * Parse formato "slug1-vs-slug2" (preferido) ou "slug1-slug2" (legacy).
 * Names compostos (e.g. "felix-auger-aliassime") obrigam à pesquisa por
 * split point para o formato legacy.
 */
export function parseMatchupSlug(
  matchup: string,
  knownSlugs: Set<string>
): [string, string] | null {
  // Format SEO-friendly: "slug1-vs-slug2"
  if (matchup.includes('-vs-')) {
    const idx = matchup.indexOf('-vs-');
    const a = matchup.slice(0, idx);
    const b = matchup.slice(idx + 4);
    if (knownSlugs.has(a) && knownSlugs.has(b)) {
      return [a, b].sort() as [string, string];
    }
    return null;
  }
  // Format legacy: "slug1-slug2" (compatibilidade com URLs antigos)
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

/**
 * Best-of-3 outcome distribution given P(p1 wins a set) = p.
 * Labels: (sets P1)-(sets P2). Ex: "2-0" = P1 ganha 2-0; "1-2" = P2 ganha 2-1.
 */
export function bo3Distribution(p: number): {
  label: string;
  prob: number;
  favP1: boolean;
}[] {
  const q = 1 - p;
  return [
    { label: '2-0', prob: p * p,         favP1: true  },
    { label: '2-1', prob: 2 * p * p * q, favP1: true  },
    { label: '1-2', prob: 2 * p * q * q, favP1: false },
    { label: '0-2', prob: q * q,         favP1: false },
  ];
}

/**
 * Best-of-5 outcome distribution given P(p1 wins a set) = p.
 * Labels: (sets P1)-(sets P2). Ex: "3-0" = P1 ganha 3-0; "1-3" = P2 ganha 3-1.
 */
export function bo5Distribution(p: number): {
  label: string;
  prob: number;
  favP1: boolean;
}[] {
  const q = 1 - p;
  return [
    { label: '3-0', prob: Math.pow(p, 3),                 favP1: true  },
    { label: '3-1', prob: 3 * Math.pow(p, 3) * q,         favP1: true  },
    { label: '3-2', prob: 6 * Math.pow(p, 3) * q * q,     favP1: true  },
    { label: '2-3', prob: 6 * Math.pow(q, 3) * p * p,     favP1: false },
    { label: '1-3', prob: 3 * Math.pow(q, 3) * p,         favP1: false },
    { label: '0-3', prob: Math.pow(q, 3),                 favP1: false },
  ];
}

/**
 * Best-of-N match probability given per-set probability.
 * Bo3: precisa de 2 sets · Bo5: precisa de 3 sets
 */
export function matchProbFromSetProb(setProb: number, bo: 3 | 5): number {
  if (bo === 3) {
    const dist = bo3Distribution(setProb);
    return dist[0].prob + dist[1].prob;
  }
  const dist = bo5Distribution(setProb);
  return dist[0].prob + dist[1].prob + dist[2].prob;
}

/**
 * Edge calculation: % vantagem do jogador vs quota da casa.
 * edge > 0 → quota da casa subvaloriza o jogador
 */
export function calculateEdge(prob: number, houseOdd: number): number {
  return (prob * houseOdd - 1) * 100;
}

/**
 * Kelly Criterion: stake ótimo como fração do bankroll.
 * f* = (b·p - q) / b
 * onde b = odd - 1, p = probabilidade, q = 1 - p
 */
export function kellyFraction(prob: number, odd: number): number {
  const b = odd - 1;
  if (b <= 0) return 0;
  const q = 1 - prob;
  return Math.max(0, (b * prob - q) / b);
}
