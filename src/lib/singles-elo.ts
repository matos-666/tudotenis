/**
 * Per-player Singles ELO updater (set-level, Phase C).
 *
 * Espelha o train_set_elo.py mas para updates incrementais — uma vez por
 * match terminado. Chamado pelo /api/cron/settle quando um pick é
 * settled e temos score conhecido.
 *
 * Estratégia:
 *   - Cada set é um update ELO independente (winner +K, loser -K)
 *   - Para o overall: aplica K_base × set_count
 *   - Para a surface: aplica K_base × surface_boost × set_count
 *   - Surface boost compensa o volume desigual (clay/grass têm menos
 *     matches no dataset, K maior para que ratings convirjam ao mesmo
 *     ritmo que o overall)
 *   - Score real: número de sets ganhos por cada player (e.g. winner=2,
 *     loser=1 num BO3 de 2-1)
 *
 * Sem per-set game scores (TennisStats só dá final set tally), aplicamos
 * o updater N vezes com winner→loser e M vezes com loser→winner. Como
 * a função de update é simétrica em sentido (winner aumenta, loser
 * diminui), a ordem dos sets não muda materialmente o rating final para
 * K pequeno (≈14-28).
 *
 * Idempotência: o caller deve gerir flag elo_applied antes de chamar.
 */
import type { SupabaseClient } from '@supabase/supabase-js';

const INITIAL_ELO = 1500;

// K-factor base por categoria. Iguais aos do train_set_elo.py.
const K_BY_CATEGORY: Record<string, number> = {
  slam: 28,
  '1000': 24,
  finals: 24,
  '500': 20,
  '250': 20,
  challenger: 16,
  itf: 14,
};

const SURFACE_K_BOOST: Record<string, number> = {
  hard: 1.30,
  clay: 1.90,
  grass: 3.20,
};

function categoryK(tournamentName: string | null | undefined): number {
  if (!tournamentName) return 20;
  const t = tournamentName;
  if (/Grand Slam|French Open|Roland Garros|Wimbledon|US Open|Australian Open/i.test(t))
    return K_BY_CATEGORY.slam;
  if (/Masters|M1000|\b1000\b|ATP Finals|WTA Finals/i.test(t))
    return K_BY_CATEGORY['1000'];
  if (/\b500\b/i.test(t)) return K_BY_CATEGORY['500'];
  if (/\b250\b/i.test(t)) return K_BY_CATEGORY['250'];
  if (/Chall\.|Challenger/i.test(t)) return K_BY_CATEGORY.challenger;
  if (/ITF|M15|M25|W15|W25|W35|W50|W75|W100/i.test(t)) return K_BY_CATEGORY.itf;
  return 20;
}

function surfaceField(surface: string | null): keyof PlayerEloFields | null {
  if (!surface) return null;
  const s = surface.toLowerCase();
  if (s === 'hard' || s === 'indoor') return 'elo_set_hard';
  if (s === 'clay') return 'elo_set_clay';
  if (s === 'grass') return 'elo_set_grass';
  return null;
}

function expected(eloA: number, eloB: number): number {
  return 1.0 / (1.0 + Math.pow(10, (eloB - eloA) / 400));
}

interface PlayerEloFields {
  id: number;
  name: string;
  elo_set_overall: number | null;
  elo_set_hard: number | null;
  elo_set_clay: number | null;
  elo_set_grass: number | null;
  set_count: number | null;
}

/**
 * Argumentos:
 *   - selectionName: nome do jogador na coluna p1_name (= pick.selection)
 *   - oppName: nome do oponente (p2_name ou p1_name dependendo)
 *   - selectionWon: o pick foi 'win' (true) ou 'loss' (false)
 *   - setsWonBySelection / setsWonByOpp: sets ganhos por cada lado
 *   - surface: 'hard'|'clay'|'grass'|'indoor' (mapeado para hard)
 *   - tournamentName: para K-factor
 */
export async function applySinglesEloUpdate(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supa: SupabaseClient<any, 'public', 'public', any, any>,
  args: {
    selectionName: string;
    oppName: string;
    selectionWon: boolean;
    setsWonBySelection: number;
    setsWonByOpp: number;
    surface: string | null;
    tournamentName: string | null;
  },
): Promise<{ ok: boolean; error?: string; details?: Record<string, unknown> }> {
  const { selectionName, oppName, surface, tournamentName } = args;
  const setsWonBySel = Math.max(0, Math.floor(args.setsWonBySelection));
  const setsWonByOpp = Math.max(0, Math.floor(args.setsWonByOpp));
  const totalSets = setsWonBySel + setsWonByOpp;
  if (totalSets === 0) {
    return { ok: false, error: 'no sets played (likely retirement 0-0)' };
  }

  // 1. Lookup both players (com fallback name-insensitive)
  async function getPlayer(name: string): Promise<PlayerEloFields | null> {
    const { data } = await supa
      .from('players')
      .select('id, name, elo_set_overall, elo_set_hard, elo_set_clay, elo_set_grass, set_count')
      .eq('name', name)
      .limit(1);
    if (data && data[0]) return data[0] as PlayerEloFields;
    // Fallback case-insensitive
    const { data: d2 } = await supa
      .from('players')
      .select('id, name, elo_set_overall, elo_set_hard, elo_set_clay, elo_set_grass, set_count')
      .ilike('name', name)
      .limit(1);
    return d2 && d2[0] ? (d2[0] as PlayerEloFields) : null;
  }

  const [sel, opp] = await Promise.all([
    getPlayer(selectionName),
    getPlayer(oppName),
  ]);
  if (!sel || !opp) {
    return {
      ok: false,
      error: `player not found: ${!sel ? selectionName : oppName}`,
    };
  }

  // 2. Determine winner/loser
  const winnerName = args.selectionWon ? selectionName : oppName;
  const setsWonByWinner = args.selectionWon ? setsWonBySel : setsWonByOpp;
  const setsWonByLoser = args.selectionWon ? setsWonByOpp : setsWonBySel;
  const winner = winnerName === sel.name ? sel : opp;
  const loser = winnerName === sel.name ? opp : sel;

  // 3. K-factor + surface boost
  const Kbase = categoryK(tournamentName);
  const sfField = surfaceField(surface);
  const sfBoost =
    surface && SURFACE_K_BOOST[surface.toLowerCase()] != null
      ? SURFACE_K_BOOST[surface.toLowerCase()]
      : surface?.toLowerCase() === 'indoor'
        ? SURFACE_K_BOOST.hard
        : 1.0;
  const Kovr = Kbase;
  const Ksurf = Kbase * sfBoost;

  // 4. Apply per-set updates. Estado per-player evolui durante a aplicação
  //    dos sets — espelhamos o train_set_elo.py.
  type Rating = { overall: number; surface: number | null };
  function init(p: PlayerEloFields): Rating {
    return {
      overall: p.elo_set_overall ?? INITIAL_ELO,
      surface: sfField ? (p[sfField] as number | null) ?? INITIAL_ELO : null,
    };
  }
  const rW = init(winner);
  const rL = init(loser);

  function applySet(wTakesSet: boolean) {
    // Overall
    const exp_w = expected(rW.overall, rL.overall);
    const actual_w = wTakesSet ? 1 : 0;
    const delta = Kovr * (actual_w - exp_w);
    rW.overall += delta;
    rL.overall -= delta;
    // Surface (se conhecida)
    if (rW.surface != null && rL.surface != null) {
      const exp_w_sf = expected(rW.surface, rL.surface);
      const delta_sf = Ksurf * (actual_w - exp_w_sf);
      rW.surface += delta_sf;
      rL.surface -= delta_sf;
    }
  }

  // Aplica sets do winner (wTakesSet=true) seguido de sets do loser
  // (wTakesSet=false). Para K pequeno, ordem não muda materialmente o resultado.
  for (let i = 0; i < setsWonByWinner; i++) applySet(true);
  for (let i = 0; i < setsWonByLoser; i++) applySet(false);

  // 5. Round + persist
  const r1 = (x: number) => Math.round(x * 10) / 10;
  const winnerUpdate: Record<string, number | null> = {
    elo_set_overall: r1(rW.overall),
    set_count: (winner.set_count ?? 0) + totalSets,
  };
  const loserUpdate: Record<string, number | null> = {
    elo_set_overall: r1(rL.overall),
    set_count: (loser.set_count ?? 0) + totalSets,
  };
  if (sfField && rW.surface != null && rL.surface != null) {
    winnerUpdate[sfField] = r1(rW.surface);
    loserUpdate[sfField] = r1(rL.surface);
  }

  const [w1, w2] = await Promise.all([
    supa.from('players').update(winnerUpdate).eq('id', winner.id),
    supa.from('players').update(loserUpdate).eq('id', loser.id),
  ]);
  if (w1.error) return { ok: false, error: `winner update: ${w1.error.message}` };
  if (w2.error) return { ok: false, error: `loser update: ${w2.error.message}` };

  return {
    ok: true,
    details: {
      winner: winner.name,
      loser: loser.name,
      score: `${setsWonByWinner}-${setsWonByLoser}`,
      overall: { w: r1(rW.overall), l: r1(rL.overall) },
      surface: sfField
        ? { field: sfField, w: rW.surface != null ? r1(rW.surface) : null, l: rL.surface != null ? r1(rL.surface) : null }
        : null,
      K: { overall: Kovr, surface: Ksurf },
    },
  };
}
