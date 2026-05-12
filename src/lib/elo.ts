/**
 * ELO win probability formula (Arpad Elo, 1960).
 * P1 wins vs P2 = 1 / (1 + 10^((elo2 - elo1) / 400))
 *
 * Como o nosso modelo treina em outcomes de match (não de set), o output
 * aproxima a probabilidade de ganhar O MATCH no formato dominante do
 * dataset (BO3, que é a maioria do tour ATP/WTA).
 */
export function eloProb(elo1: number, elo2: number): number {
  return 1 / (1 + Math.pow(10, (elo2 - elo1) / 400));
}

/**
 * Probabilidade de ganhar O MATCH a partir de ELO **set-level**
 * (treinado em outcomes de set, não de match), composto via fórmula BO3/BO5.
 *
 * Phase C: assume os ELOs passados são set-level (colunas elo_set_*).
 * Para back-compat, se o caller passar match-level ELOs, usa o helper
 * `matchProbFromMatchElo` em vez deste.
 */
export function matchProb(setElo1: number, setElo2: number, bo: 3 | 5 = 3): number {
  const setP = eloProb(setElo1, setElo2);
  return matchProbFromSetProb(setP, bo);
}

/**
 * Fallback: probabilidade a partir de ELO match-level (não treinado em sets).
 * Usado quando o jogador ainda não tem set-level ELO populado.
 * Para BO5 aproxima via inversão→recomposição (hack).
 */
export function matchProbFromMatchElo(elo1: number, elo2: number, bo: 3 | 5 = 3): number {
  const base = eloProb(elo1, elo2);
  if (bo === 3) return base;
  const setP = setProbFromMatchProb(base, 3);
  return matchProbFromSetProb(setP, 5);
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
 * Inverso de matchProbFromSetProb — dado o output do ELO (match-level
 * porque o nosso modelo treina com vencedor/perdedor por jogo), deriva
 * a probabilidade por set implícita usando binary search.
 *
 * Usado pelo Predictor para que a distribuição de scores Monte Carlo
 * seja consistente com a match probability mostrada no topo.
 */
export function setProbFromMatchProb(matchProb: number, bo: 3 | 5): number {
  if (matchProb <= 0) return 0;
  if (matchProb >= 1) return 1;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (matchProbFromSetProb(mid, bo) < matchProb) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
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

/**
 * Converte set-level ELO interno → display ELO em escala match-level.
 *
 * O nosso modelo treina em outcomes de set (Phase C), logo eloProb(setELO)
 * devolve probabilidade por set. Internamente todos os cálculos
 * (probabilidades, EV, picks) usam set-ELO. Para a UI, convertemos para
 * a escala match-level que Tennis Abstract e a maioria das publicações
 * de tennis stats usam, para os números serem comparáveis.
 *
 * Pipeline: setELO → P(set vs 1500) → P(BO3 match) → inverso eloProb → matchELO
 *
 * Exemplo: setELO 2003 (Sinner) → P(set vs 1500) ≈ 0.948 →
 *          P(BO3) ≈ 0.992 → matchELO display ≈ 2338  ≈ TA 2331.
 */
export function displayElo(setElo: number | null | undefined): number | null {
  if (setElo == null) return null;
  const setProb = 1 / (1 + Math.pow(10, -(setElo - 1500) / 400));
  const bo3Prob = setProb * setProb * (3 - 2 * setProb);
  // Clamp para evitar Infinity nos extremos
  const p = Math.max(0.001, Math.min(0.999, bo3Prob));
  return 1500 + 400 * Math.log10(p / (1 - p));
}
