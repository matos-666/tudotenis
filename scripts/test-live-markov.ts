/**
 * Sanity tests for live-markov engine — validates against published
 * O'Malley / Klaassen-Magnus closed-form values.
 *
 * Run: npx tsx scripts/test-live-markov.ts
 */
import {
  holdProb,
  gameWinFromPointState,
  tiebreakWinProb,
  setWinFromGameState,
  matchWinProb,
  pointImportance,
  applyPointResult,
  priorsFromElo,
  bayesianServeUpdate,
  type MatchState,
} from '../src/lib/live-markov';

let pass = 0;
let fail = 0;
const TOL = 1e-3;

function approx(label: string, actual: number, expected: number, tol = TOL): void {
  const diff = Math.abs(actual - expected);
  if (diff < tol) {
    pass++;
    console.log(`  ✓ ${label} = ${actual.toFixed(4)} (exp ${expected.toFixed(4)})`);
  } else {
    fail++;
    console.log(`  ✗ ${label} = ${actual.toFixed(4)} (exp ${expected.toFixed(4)}, diff ${diff.toFixed(4)})`);
  }
}

console.log('\n── L2a: game hold (O\'Malley closed form) ──');
// p=0.5 → 50% hold (symmetric coin)
approx('hold @ p=0.50', holdProb(0.5), 0.5);
// p=0.65 → ~82.7% (canonical ATP hard avg)
approx('hold @ p=0.65', holdProb(0.65), 0.8267, 0.01);
// p=0.70 → ~90% (good server)
approx('hold @ p=0.70', holdProb(0.7), 0.9007, 0.01);
// p=0.80 → ~97.8% (huge server)
approx('hold @ p=0.80', holdProb(0.8), 0.9785, 0.01);

console.log('\n── L2a: gameWinFromPointState ──');
// From love-love must equal holdProb
approx('(0,0) p=0.65', gameWinFromPointState(0.65, 0, 0), holdProb(0.65));
// Deuce: p²/(p²+q²)
approx('deuce p=0.65', gameWinFromPointState(0.65, 3, 3), 0.4225 / (0.4225 + 0.1225), 1e-4);
// Ad-In: p + q·deuce
const deuce65 = 0.4225 / (0.4225 + 0.1225);
approx('ad-in p=0.65', gameWinFromPointState(0.65, 4, 3), 0.65 + 0.35 * deuce65);
// 40-0 → near-certain win. Derivation: P(receiver wins from 3-0) = q³ · q²/(p²+q²)
//   = 0.35³ · 0.1225/0.545 = 0.0429 · 0.2248 = 0.00965 → P(server wins) ≈ 0.9903
approx('40-0 p=0.65', gameWinFromPointState(0.65, 3, 0), 0.9904);
// 0-40 → unlikely but not negligible. P(server wins) = p³ · p²/(p²+q²)
//   = 0.65³ · 0.7752 = 0.2746 · 0.7752 = 0.2129
approx('0-40 p=0.65', gameWinFromPointState(0.65, 0, 3), 0.2129);

console.log('\n── L2b: tiebreak ──');
// Equal players, A serves first → 50/50
approx('TB 7-pt symmetric', tiebreakWinProb(0.65, 0.65, 0, 0, 7, 'A'), 0.5, 1e-3);
// Asymmetric (A is stronger server)
const tbAsym = tiebreakWinProb(0.70, 0.60, 0, 0, 7, 'A');
console.log(`  · TB asym (pA=0.7, pB=0.6) = ${tbAsym.toFixed(4)} (expect > 0.5)`);
if (tbAsym > 0.55 && tbAsym < 0.85) pass++; else fail++;
// Mid-TB: A leads 5-2
const tbLead = tiebreakWinProb(0.65, 0.65, 5, 2, 7, 'A');
console.log(`  · TB 5-2 = ${tbLead.toFixed(4)} (expect ~0.95+)`);
if (tbLead > 0.90) pass++; else fail++;

console.log('\n── L2c: set ──');
// Equal players from 0-0 → 50/50
approx('set @ 0-0 symmetric', setWinFromGameState(0.65, 0.65, 0, 0, 'A', 7), 0.5, 1e-2);
// Strong server (0.75) vs weaker (0.55) → A wins set ~85%+
const setAsym = setWinFromGameState(0.75, 0.55, 0, 0, 'A', 7);
console.log(`  · set asym (0.75 vs 0.55) = ${setAsym.toFixed(4)} (expect > 0.80)`);
if (setAsym > 0.80) pass++; else fail++;

console.log('\n── L2d: match (BO3 / BO5) ──');
const baseState: MatchState = {
  ptA: 0, ptB: 0, gA: 0, gB: 0, sA: 0, sB: 0,
  server: 'A', bestOf: 3, tiebreak: false, finalSetSuperTiebreak: true,
};
// Equal players BO3 → 50/50
approx('match BO3 symmetric', matchWinProb(baseState, 0.65, 0.65), 0.5, 1e-2);
// Asymmetric BO3
const matchAsym3 = matchWinProb(baseState, 0.70, 0.60);
console.log(`  · BO3 (0.70 vs 0.60) = ${matchAsym3.toFixed(4)} (expect ~0.80+)`);
if (matchAsym3 > 0.75 && matchAsym3 < 0.95) pass++; else fail++;
// Same matchup BO5 — favorite advantage amplifies
const matchAsym5 = matchWinProb({ ...baseState, bestOf: 5 }, 0.70, 0.60);
console.log(`  · BO5 (0.70 vs 0.60) = ${matchAsym5.toFixed(4)} (expect > BO3 above)`);
if (matchAsym5 > matchAsym3) pass++; else fail++;

console.log('\n── L2d: match mid-state ──');
// A serving for the match: BO3, 1-0 sets, 5-3 games, 40-15, A serves
const matchPoint: MatchState = {
  ptA: 3, ptB: 1, gA: 5, gB: 3, sA: 1, sB: 0,
  server: 'A', bestOf: 3, tiebreak: false, finalSetSuperTiebreak: false,
};
const pMatchPt = matchWinProb(matchPoint, 0.65, 0.65);
console.log(`  · match point @ 40-15 5-3 1-0 (equal players) = ${pMatchPt.toFixed(4)} (expect > 0.95)`);
if (pMatchPt > 0.95) pass++; else fail++;

// Down a set, down a break in set 2 — should be tough
const downABreak: MatchState = {
  ptA: 0, ptB: 0, gA: 1, gB: 3, sA: 0, sB: 1,
  server: 'A', bestOf: 3, tiebreak: false, finalSetSuperTiebreak: false,
};
const pDownBreak = matchWinProb(downABreak, 0.65, 0.65);
console.log(`  · -1 set, -1 break @ 1-3 (equal players) = ${pDownBreak.toFixed(4)} (expect < 0.20)`);
if (pDownBreak < 0.20) pass++; else fail++;

console.log('\n── L5a: point importance ──');
// 40-40 (deuce) on serve → break point swing very high
const deuceState: MatchState = {
  ptA: 3, ptB: 3, gA: 5, gB: 5, sA: 1, sB: 1,
  server: 'A', bestOf: 3, tiebreak: false, finalSetSuperTiebreak: true,
};
const imp = pointImportance(deuceState, 0.65, 0.65);
console.log(`  · I @ deuce 5-5 set3 = ${imp.toFixed(4)} (expect > 0.10)`);
if (imp > 0.10) pass++; else fail++;

// Trivial state (40-0 up a break in set 1) — low importance
const trivialState: MatchState = {
  ptA: 3, ptB: 0, gA: 2, gB: 0, sA: 0, sB: 0,
  server: 'A', bestOf: 3, tiebreak: false, finalSetSuperTiebreak: false,
};
const trivialImp = pointImportance(trivialState, 0.65, 0.65);
console.log(`  · I @ 40-0 2-0 0-0 = ${trivialImp.toFixed(4)} (expect < 0.05)`);
if (trivialImp < 0.05) pass++; else fail++;

console.log('\n── L1: priors from ELO ──');
// Equal ELO → baseline
const eq = priorsFromElo({ eloA: 2000, eloB: 2000, tour: 'atp', surface: 'grass' });
approx('eq ELO grass ATP', eq.pA, 0.68);
approx('eq ELO grass ATP (B)', eq.pB, 0.68);
// 100 ELO gap → ~2.5% shift
const gap = priorsFromElo({ eloA: 2100, eloB: 2000, tour: 'atp', surface: 'hard' });
approx('+100 ELO hard ATP (A)', gap.pA, 0.665, 1e-3);
approx('+100 ELO hard ATP (B)', gap.pB, 0.615, 1e-3);

console.log('\n── L3: Bayesian update ──');
// n=0 → prior unchanged
approx('bayes n=0', bayesianServeUpdate(0.65, 0, 0, 80), 0.65);
// k=80, prior=0.65, observed 30/40 (under-performing)
// posterior = (80·0.65 + 30) / (80 + 40) = 82 / 120 = 0.6833
approx('bayes 30/40 k=80', bayesianServeUpdate(0.65, 30, 40, 80), 82/120);
// Strong overperformance: 90/100 with prior 0.65, k=80
// posterior = (80·0.65 + 90) / 180 = 142 / 180 = 0.7889
approx('bayes 90/100 k=80', bayesianServeUpdate(0.65, 90, 100, 80), 142/180);

console.log('\n── applyPointResult ──');
// 40-15, A serves, A wins → game over, alternates server
const before: MatchState = {
  ptA: 3, ptB: 1, gA: 4, gB: 4, sA: 0, sB: 0,
  server: 'A', bestOf: 3, tiebreak: false, finalSetSuperTiebreak: false,
};
const after = applyPointResult(before, 'A');
console.log(`  before: server A, 40-15, 4-4`);
console.log(`  after:  server ${after.server}, ${after.ptA}-${after.ptB}, ${after.gA}-${after.gB}, sets ${after.sA}-${after.sB}, TB=${after.tiebreak}`);
if (after.gA === 5 && after.gB === 4 && after.ptA === 0 && after.server === 'B') pass++; else fail++;

// 6-5 set, A serves, wins game from 40-30 → set over (7-5)
const setPt: MatchState = {
  ptA: 3, ptB: 2, gA: 6, gB: 5, sA: 0, sB: 0,
  server: 'A', bestOf: 3, tiebreak: false, finalSetSuperTiebreak: false,
};
const afterSet = applyPointResult(setPt, 'A');
console.log(`  set point: server A, 40-30, 6-5 → after sets ${afterSet.sA}-${afterSet.sB}, games ${afterSet.gA}-${afterSet.gB}`);
if (afterSet.sA === 1 && afterSet.gA === 0 && afterSet.gB === 0) pass++; else fail++;

// 6-6, A serves first of TB → tiebreak begins
const sixSix: MatchState = {
  ptA: 3, ptB: 3, gA: 5, gB: 6, sA: 0, sB: 0,
  server: 'A', bestOf: 3, tiebreak: false, finalSetSuperTiebreak: false,
};
// First A holds the game at 5-6 to make it 6-6 then tiebreak should start
const afterHold = applyPointResult({ ...sixSix, ptA: 3, ptB: 2 }, 'A');
console.log(`  hold 40-30 to 6-6 → games ${afterHold.gA}-${afterHold.gB}, TB=${afterHold.tiebreak}`);
if (afterHold.gA === 6 && afterHold.gB === 6 && afterHold.tiebreak) pass++; else fail++;

console.log(`\n──── ${pass} passed · ${fail} failed ────\n`);
if (fail > 0) process.exit(1);
