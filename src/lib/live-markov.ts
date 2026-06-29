/**
 * In-play tennis Markov engine.
 *
 * Bottom-up: serve point win probs (p_A, p_B) → game hold → set →
 * match probability. References: O'Malley (2008), Klaassen-Magnus
 * (2001), Newton-Aslam (2009). Deuce subcycle solved analytically;
 * everything else is bounded DP (<1000 states for a full match
 * snapshot, sub-millisecond compute).
 *
 * Conventions:
 *   - "A" = player whose match-win probability we compute
 *   - Points within a game: 0=0, 1=15, 2=30, 3=40, 4+ = post-deuce
 *   - All probs in [0, 1]
 *   - Server alternates by game; within a tiebreak, ABBA pattern
 */

export type Server = 'A' | 'B';
export type BestOf = 3 | 5;

export interface MatchState {
  ptA: number;
  ptB: number;
  gA: number;
  gB: number;
  sA: number;
  sB: number;
  server: Server;
  bestOf: BestOf;
  /** True if the current game is a tiebreak. */
  tiebreak: boolean;
  /**
   * True when format uses 10-pt super-tiebreak in the decisive set
   * (Wimbledon, AO, US Open, RG since 2022). The 10-pt rule kicks in
   * only when sA + sB === bestOf - 1 AND set reaches 6-6.
   */
  finalSetSuperTiebreak: boolean;
}

// ── Layer 2a — Game-level hold probability ──────────────────────────────────

/**
 * P(server wins the current game from love-love), per O'Malley closed form.
 * Decomposes wins by 4-0, 4-1, 4-2, and from-deuce (geometric sum).
 */
export function holdProb(p: number): number {
  const q = 1 - p;
  const win40 = Math.pow(p, 4);
  const win41 = 4 * Math.pow(p, 4) * q;
  const win42 = 10 * Math.pow(p, 4) * q * q;
  const deuceReached = 20 * Math.pow(p, 3) * Math.pow(q, 3);
  const winFromDeuce = (p * p) / (p * p + q * q);
  return win40 + win41 + win42 + deuceReached * winFromDeuce;
}

/**
 * P(server wins the current game from arbitrary point state).
 * Uses memoized recursion; handles deuce-and-beyond via the
 * closed-form p²/(p²+q²) once both players reach 3.
 */
export function gameWinFromPointState(p: number, ptS: number, ptR: number): number {
  if (ptS >= 4 && ptS - ptR >= 2) return 1;
  if (ptR >= 4 && ptR - ptS >= 2) return 0;
  if (ptS >= 3 && ptR >= 3) {
    const q = 1 - p;
    const winDeuce = (p * p) / (p * p + q * q);
    if (ptS === ptR) return winDeuce;
    if (ptS === ptR + 1) return p + (1 - p) * winDeuce;
    return p * winDeuce;
  }
  const q = 1 - p;
  return (
    p * gameWinFromPointState(p, ptS + 1, ptR) +
    q * gameWinFromPointState(p, ptS, ptR + 1)
  );
}

// ── Layer 2b — Tiebreak win probability ────────────────────────────────────

/**
 * Returns who serves the next point of a tiebreak after `t` points
 * have been played. ABBA pattern: A serves point 0; B serves 1,2;
 * A serves 3,4; B serves 5,6; ...
 *
 * Closed form: A serves iff ((t + 1) >> 1) is even.
 */
export function tiebreakServer(pointIndex: number, firstServer: Server): Server {
  const aServes = ((pointIndex + 1) >> 1) % 2 === 0;
  if (firstServer === 'A') return aServes ? 'A' : 'B';
  return aServes ? 'B' : 'A';
}

/**
 * P(A wins a target-point tiebreak from current score (a,b),
 * given who served the FIRST point.
 *
 * @param target  7 for regular set TB, 10 for super-TB (final set)
 * @param firstServer  Player who served the first point of the TB
 */
export function tiebreakWinProb(
  pA: number,
  pB: number,
  a: number,
  b: number,
  target: number,
  firstServer: Server,
): number {
  if (a >= target && a - b >= 2) return 1;
  if (b >= target && b - a >= 2) return 0;
  // Sudden death closed form: once both reach target-1 AND tied, the
  // ABBA pattern guarantees the next two points contain exactly one
  // A-serve and one B-serve, so:
  //   P(A wins both) = pA·(1-pB)
  //   P(B wins both) = (1-pA)·pB
  //   P(tied)        = pA·pB + (1-pA)·(1-pB)
  // Loop → P(A wins TB | tied at SD) = pA(1-pB) / (pA(1-pB) + (1-pA)pB)
  if (a === b && a >= target - 1) {
    const aBoth = pA * (1 - pB);
    const bBoth = (1 - pA) * pB;
    if (aBoth + bBoth === 0) return 0.5;
    return aBoth / (aBoth + bBoth);
  }
  const t = a + b;
  const srv = tiebreakServer(t, firstServer);
  const pAwinsThisPoint = srv === 'A' ? pA : 1 - pB;
  return (
    pAwinsThisPoint * tiebreakWinProb(pA, pB, a + 1, b, target, firstServer) +
    (1 - pAwinsThisPoint) * tiebreakWinProb(pA, pB, a, b + 1, target, firstServer)
  );
}

// ── Layer 2c — Set-level win probability ───────────────────────────────────

/**
 * P(A wins the current set from (gA, gB) with `server` about to serve
 * the NEXT game. Uses memoized DP. At 6-6 dispatches to tiebreak.
 *
 * @param tbTarget    7 for normal sets, 10 for the final set when
 *                    finalSetSuperTiebreak is true
 */
export function setWinFromGameState(
  pA: number,
  pB: number,
  gA: number,
  gB: number,
  server: Server,
  tbTarget: number,
): number {
  if (gA >= 6 && gA - gB >= 2) return 1;
  if (gB >= 6 && gB - gA >= 2) return 0;
  if (gA === 7 && gB === 5) return 1;
  if (gA === 5 && gB === 7) return 0;
  if (gA === 6 && gB === 6) {
    return tiebreakWinProb(pA, pB, 0, 0, tbTarget, server);
  }
  const holdA = holdProb(pA);
  const holdB = holdProb(pB);
  const next: Server = server === 'A' ? 'B' : 'A';
  if (server === 'A') {
    return (
      holdA * setWinFromGameState(pA, pB, gA + 1, gB, next, tbTarget) +
      (1 - holdA) * setWinFromGameState(pA, pB, gA, gB + 1, next, tbTarget)
    );
  }
  return (
    (1 - holdB) * setWinFromGameState(pA, pB, gA + 1, gB, next, tbTarget) +
    holdB * setWinFromGameState(pA, pB, gA, gB + 1, next, tbTarget)
  );
}

// ── Layer 2d — Match-level win probability ─────────────────────────────────

/**
 * P(A wins the match given a full state snapshot.
 *
 * Composition rule: from the current point, finish this game, finish
 * this set, then plug into BO3/BO5 set tree. Uses the EXACT current
 * point/game/set state (no resetting to 0-0).
 */
export function matchWinProb(state: MatchState, pA: number, pB: number): number {
  const setsToWin = state.bestOf === 3 ? 2 : 3;

  // P(A wins the current set) from the current point onwards
  const pCurSet = currentSetWinProb(state, pA, pB);

  // P(A wins a future, fresh set) — server alternates set-by-set, but the
  // probability of *winning a set* is symmetric in service order for IID
  // points (the boundary is the same). Use server=A as canonical baseline.
  const isFinal = state.sA + state.sB === setsToWin * 2 - 2;
  const finalTb = state.finalSetSuperTiebreak;
  const tbTarget = isFinal && finalTb ? 10 : 7;
  // Approximation: future sets have the same per-set win prob regardless
  // of which player serves first (the boundary is symmetric in IID).
  const pFreshSet = setWinFromGameState(pA, pB, 0, 0, 'A', 7);

  return composeMatchFromSetProbs(state.sA, state.sB, setsToWin, pCurSet, pFreshSet, finalTb, tbTarget, pA, pB);
}

/**
 * P(A wins the CURRENT set) — composes finishing the current game and
 * then the rest of the set, accounting for tiebreak / final-set rules.
 */
function currentSetWinProb(state: MatchState, pA: number, pB: number): number {
  const setsToWin = state.bestOf === 3 ? 2 : 3;
  const isFinalSet = state.sA + state.sB === setsToWin * 2 - 2;
  const tbTarget = isFinalSet && state.finalSetSuperTiebreak ? 10 : 7;

  if (state.tiebreak) {
    return tiebreakWinProb(pA, pB, state.ptA, state.ptB, tbTarget, state.server);
  }
  const pServer = state.server === 'A' ? pA : pB;
  const sPts = state.server === 'A' ? state.ptA : state.ptB;
  const rPts = state.server === 'A' ? state.ptB : state.ptA;
  const gameWinForServer = gameWinFromPointState(pServer, sPts, rPts);
  const gwA = state.server === 'A' ? gameWinForServer : 1 - gameWinForServer;
  const nextServer: Server = state.server === 'A' ? 'B' : 'A';
  const ifAWinsGame = setWinFromGameState(pA, pB, state.gA + 1, state.gB, nextServer, tbTarget);
  const ifBWinsGame = setWinFromGameState(pA, pB, state.gA, state.gB + 1, nextServer, tbTarget);
  return gwA * ifAWinsGame + (1 - gwA) * ifBWinsGame;
}

/**
 * BO3 / BO5 match composition given P(A wins current set) and P(A wins
 * a future fresh set). The final set uses the super-TB rule if enabled.
 */
function composeMatchFromSetProbs(
  sA: number,
  sB: number,
  setsToWin: number,
  pCurSet: number,
  pFreshSet: number,
  finalSuperTb: boolean,
  tbTarget: number,
  pA: number,
  pB: number,
): number {
  if (sA >= setsToWin) return 1;
  if (sB >= setsToWin) return 0;

  function rec(a: number, b: number, isCurrent: boolean): number {
    if (a >= setsToWin) return 1;
    if (b >= setsToWin) return 0;
    const isFinalSet = a + b === setsToWin * 2 - 2;
    let pSet: number;
    if (isCurrent) {
      pSet = pCurSet;
    } else if (isFinalSet && finalSuperTb) {
      pSet = setWinFromGameState(pA, pB, 0, 0, 'A', 10);
    } else {
      pSet = pFreshSet;
    }
    return pSet * rec(a + 1, b, false) + (1 - pSet) * rec(a, b + 1, false);
  }

  return rec(sA, sB, true);
}

// ── Layer 1 — Prior: set-ELO → serve win probabilities ─────────────────────

/**
 * Surface-aware baseline serve-point win % per tour.
 * Source: research doc (Klaassen-Magnus tables on Wimbledon + general
 * tour averages from Match Charting Project).
 */
export const SURFACE_SERVE_BASELINE = {
  atp: { hard: 0.640, clay: 0.620, grass: 0.680, indoor: 0.660 },
  wta: { hard: 0.555, clay: 0.555, grass: 0.585, indoor: 0.575 },
} as const;

/**
 * Convert per-player ELO + surface into per-player serve point win
 * probability priors. We don't have ball-tracking SQS, so we use a
 * simpler decomposition:
 *
 *   1. baseline_serve(tour, surface) is the average serve % on that surface
 *   2. ELO gap shifts serve % up/down for the stronger player
 *   3. Constraint: pA + (1 - pB) ≈ implied total point share matching
 *      the ELO-derived set probability
 *
 * Calibration: we assume each 100 ELO points = ~2.5% shift in serve %
 * (Sackmann-style ATP empirical fit). Sign convention: stronger player
 * gets higher p, weaker player lower.
 */
export function priorsFromElo(opts: {
  eloA: number;
  eloB: number;
  tour: 'atp' | 'wta';
  surface: 'hard' | 'clay' | 'grass' | 'indoor';
}): { pA: number; pB: number } {
  const base = SURFACE_SERVE_BASELINE[opts.tour][opts.surface];
  const eloGap = opts.eloA - opts.eloB;
  // 100 ELO ≈ 2.5% serve % shift; clamp to keep within realistic bounds
  const shift = Math.max(-0.10, Math.min(0.10, (eloGap / 100) * 0.025));
  const pA = clamp(base + shift, 0.40, 0.85);
  const pB = clamp(base - shift, 0.40, 0.85);
  return { pA, pB };
}

function clamp(x: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, x));
}

// ── Layer 3 — Bayesian update (Beta-Binomial) ──────────────────────────────

/**
 * Conjugate Beta-Binomial update for serve point win probability.
 *
 *   posterior_mean = (k · p_prior + s) / (k + n)
 *
 * Where s = serve points won live, n = serve points played live,
 * k = prior strength (recommended 60-100 for high-liquidity tennis).
 *
 * Phase doctrine (per research, naturally emergent from the formula):
 *   n=0     → posterior = prior
 *   n=k     → posterior = (prior + observed) / 2
 *   n=2k    → posterior weight 1/3 prior, 2/3 observed
 *   n→∞     → posterior → observed
 */
export function bayesianServeUpdate(
  pPrior: number,
  servePointsWon: number,
  servePointsPlayed: number,
  k: number = 80,
): number {
  if (servePointsPlayed === 0) return pPrior;
  const numerator = k * pPrior + servePointsWon;
  const denominator = k + servePointsPlayed;
  return clamp(numerator / denominator, 0.30, 0.95);
}

// ── Layer 5a — Importance of point ─────────────────────────────────────────

/**
 * I(i,j) = P(match | A wins next point) − P(match | A loses next point).
 *
 * High importance = volatile state. When I > 0.20 the model should
 * suspend pick generation (anti-latency: cannot beat fast-moving
 * markets). Returns I in [0, 1].
 */
export function pointImportance(state: MatchState, pA: number, pB: number): number {
  if (state.tiebreak) {
    const ifAwins: MatchState = { ...state, ptA: state.ptA + 1 };
    const ifBwins: MatchState = { ...state, ptB: state.ptB + 1 };
    return Math.abs(matchWinProb(ifAwins, pA, pB) - matchWinProb(ifBwins, pA, pB));
  }
  const ifAwins: MatchState = applyPointResult(state, 'A');
  const ifBwins: MatchState = applyPointResult(state, 'B');
  return Math.abs(matchWinProb(ifAwins, pA, pB) - matchWinProb(ifBwins, pA, pB));
}

/**
 * Apply the outcome of one point and return the resulting state.
 * Handles game end (transitions to next game, alternates server),
 * set end (transitions to next set), and tiebreak transitions.
 */
export function applyPointResult(state: MatchState, winner: Server): MatchState {
  if (state.tiebreak) {
    const ptA = winner === 'A' ? state.ptA + 1 : state.ptA;
    const ptB = winner === 'B' ? state.ptB + 1 : state.ptB;
    const setsToWin = state.bestOf === 3 ? 2 : 3;
    const isFinal = state.sA + state.sB === setsToWin * 2 - 2;
    const target = isFinal && state.finalSetSuperTiebreak ? 10 : 7;
    const aWin = ptA >= target && ptA - ptB >= 2;
    const bWin = ptB >= target && ptB - ptA >= 2;
    if (aWin || bWin) {
      const setsA = state.sA + (aWin ? 1 : 0);
      const setsB = state.sB + (bWin ? 1 : 0);
      return {
        ...state,
        ptA: 0, ptB: 0,
        gA: 0, gB: 0,
        sA: setsA, sB: setsB,
        tiebreak: false,
        server: state.server === 'A' ? 'B' : 'A',
      };
    }
    return { ...state, ptA, ptB };
  }

  const serverWonPoint = winner === state.server;
  const newPtS = (state.server === 'A' ? state.ptA : state.ptB) + (serverWonPoint ? 1 : 0);
  const newPtR = (state.server === 'A' ? state.ptB : state.ptA) + (serverWonPoint ? 0 : 1);
  const gameOver =
    (newPtS >= 4 && newPtS - newPtR >= 2) ||
    (newPtR >= 4 && newPtR - newPtS >= 2);

  if (!gameOver) {
    return state.server === 'A'
      ? { ...state, ptA: newPtS, ptB: newPtR }
      : { ...state, ptA: newPtR, ptB: newPtS };
  }

  // Game ended → update games, alternate server, check for set end
  const serverWonGame = newPtS > newPtR;
  const gameWinner: Server = serverWonGame ? state.server : (state.server === 'A' ? 'B' : 'A');
  const newGA = state.gA + (gameWinner === 'A' ? 1 : 0);
  const newGB = state.gB + (gameWinner === 'B' ? 1 : 0);

  // Check set end
  const setEndedA = newGA >= 6 && newGA - newGB >= 2;
  const setEndedB = newGB >= 6 && newGB - newGA >= 2;
  const setEnded75 = (newGA === 7 && newGB === 5) || (newGB === 7 && newGA === 5);
  const goingToTb = newGA === 6 && newGB === 6;

  if (setEndedA || setEndedB || setEnded75) {
    const aWon = setEndedA || (newGA === 7 && newGB === 5);
    return {
      ...state,
      ptA: 0, ptB: 0,
      gA: 0, gB: 0,
      sA: state.sA + (aWon ? 1 : 0),
      sB: state.sB + (aWon ? 0 : 1),
      tiebreak: false,
      // After a regular set, the player who DID NOT serve the last game
      // serves the first game of the next set. Since servers alternated
      // game by game, the next set's first server = the one who is about
      // to serve the next game right now.
      server: state.server === 'A' ? 'B' : 'A',
    };
  }

  if (goingToTb) {
    return {
      ...state,
      ptA: 0, ptB: 0,
      gA: newGA, gB: newGB,
      tiebreak: true,
      // Tiebreak first server = player who would have served next game
      server: state.server === 'A' ? 'B' : 'A',
    };
  }

  return {
    ...state,
    ptA: 0, ptB: 0,
    gA: newGA, gB: newGB,
    server: state.server === 'A' ? 'B' : 'A',
  };
}
