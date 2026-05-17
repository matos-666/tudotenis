/**
 * Sistema i18n minimalista para TudoTénis.
 *
 * Dois locales suportados:
 *   - 'pt-PT' (default, URLs sem prefix)
 *   - 'pt-BR' (sob /br/*)
 *
 * Uso típico:
 *   import { t, type Locale } from '@/lib/i18n';
 *   <h1>{t(locale, 'home.tagline')}</h1>
 *
 * Se uma chave não existir em pt-BR, faz fallback para pt-PT.
 * Nunca usar em components client — para já só server.
 */

export type Locale = 'pt-PT' | 'pt-BR';

export const LOCALES: Locale[] = ['pt-PT', 'pt-BR'];
export const DEFAULT_LOCALE: Locale = 'pt-PT';

const dict = {
  // ── Brand / common ─────────────────────────────────────────────────────
  'brand.tagline':           { 'pt-PT': 'Picks ELO + stats que ninguém mais publica em português.',
                               'pt-BR': 'Picks ELO + stats que ninguém mais publica em português.' },
  'brand.disclaimer':        { 'pt-PT': 'Modelo ELO próprio · Joga responsável · +18',
                               'pt-BR': 'Modelo ELO próprio · Jogue com responsabilidade · +18' },

  // Navigation
  'nav.home':                { 'pt-PT': 'Início',         'pt-BR': 'Início' },
  'nav.picks':               { 'pt-PT': 'Picks do dia',   'pt-BR': 'Palpites do dia' },
  'nav.players':             { 'pt-PT': 'Jogadores',      'pt-BR': 'Jogadores' },
  'nav.h2h':                 { 'pt-PT': 'H2H',            'pt-BR': 'H2H' },
  'nav.tools':               { 'pt-PT': 'Ferramentas',    'pt-BR': 'Ferramentas' },
  'nav.ranking':             { 'pt-PT': 'Ranking ELO',    'pt-BR': 'Ranking ELO' },
  'nav.tournaments':         { 'pt-PT': 'Torneios',       'pt-BR': 'Torneios' },
  'nav.specialists':         { 'pt-PT': 'Specialists',    'pt-BR': 'Specialists' },
  'nav.how':                 { 'pt-PT': 'Como funciona',  'pt-BR': 'Como funciona' },

  // ── Common terms (the words that DIFFER between PT and BR) ──────────────
  'term.tennis':             { 'pt-PT': 'Ténis',          'pt-BR': 'Tênis' },        // a chave!
  'term.team':               { 'pt-PT': 'Equipa',         'pt-BR': 'Time' },
  'term.update':             { 'pt-PT': 'Atualizar',     'pt-BR': 'Atualizar' },
  'term.updated':            { 'pt-PT': 'Atualizado',    'pt-BR': 'Atualizado' },
  'term.activity':           { 'pt-PT': 'Atividade',     'pt-BR': 'Atividade' },
  'term.clay':               { 'pt-PT': 'Terra batida',   'pt-BR': 'Saibro' },
  'term.hard':               { 'pt-PT': 'Hard',           'pt-BR': 'Hard' },
  'term.grass':              { 'pt-PT': 'Relvado',        'pt-BR': 'Grama' },
  'term.indoor':             { 'pt-PT': 'Indoor',         'pt-BR': 'Indoor' },
  'term.bet':                { 'pt-PT': 'Aposta',         'pt-BR': 'Aposta' },
  'term.bet_verb':           { 'pt-PT': 'Apostar',        'pt-BR': 'Apostar' },
  'term.odd':                { 'pt-PT': 'Quota',          'pt-BR': 'Odd' },
  'term.odd_short':          { 'pt-PT': 'Quota',          'pt-BR': 'Odd' },
  'term.winner_m':           { 'pt-PT': 'Vencedor',       'pt-BR': 'Vencedor' },
  'term.winner_f':           { 'pt-PT': 'Vencedora',      'pt-BR': 'Vencedora' },
  'term.opponent':           { 'pt-PT': 'Adversário',     'pt-BR': 'Adversário' },
  'term.result':             { 'pt-PT': 'Resultado',      'pt-BR': 'Resultado' },
  'term.matches':            { 'pt-PT': 'Jogos',          'pt-BR': 'Jogos' },
  'term.players_count':      { 'pt-PT': 'jogadores',      'pt-BR': 'jogadores' },
  'term.live':               { 'pt-PT': 'AO VIVO',        'pt-BR': 'AO VIVO' },
  'term.live_today':         { 'pt-PT': 'EM CURSO',       'pt-BR': 'EM ANDAMENTO' },
  'term.upcoming':           { 'pt-PT': 'PRÓXIMO',        'pt-BR': 'PRÓXIMO' },
  'term.tour':               { 'pt-PT': 'Tour',           'pt-BR': 'Tour' },
  'term.surface':            { 'pt-PT': 'Superfície',     'pt-BR': 'Piso' },
  'term.ranking':            { 'pt-PT': 'Ranking',        'pt-BR': 'Ranking' },

  // ── Stats labels ────────────────────────────────────────────────────────
  'stat.yield':              { 'pt-PT': 'Yield total',    'pt-BR': 'Yield total' },
  'stat.tips':               { 'pt-PT': 'Tips auditados', 'pt-BR': 'Tips auditados' },
  'stat.winrate':            { 'pt-PT': 'Win rate',       'pt-BR': 'Taxa de acerto' },
  'stat.settlement':         { 'pt-PT': 'Settlement',     'pt-BR': 'Liquidação' },
  'stat.players':            { 'pt-PT': 'Jogadores',      'pt-BR': 'Jogadores' },

  // ── Homepage ─────────────────────────────────────────────────────────────
  'home.title':              { 'pt-PT': 'Picks ELO + stats que ninguém mais publica em português.',
                               'pt-BR': 'Palpites ELO + stats que ninguém mais publica em português.' },
  'home.subtitle':           { 'pt-PT': 'Modelo ELO próprio · cobertura ATP + WTA · settlement automático.',
                               'pt-BR': 'Modelo ELO próprio · cobertura ATP + WTA · liquidação automática.' },
  'home.cta.picks':          { 'pt-PT': 'Ver picks de hoje',     'pt-BR': 'Ver palpites de hoje' },
  'home.cta.ranking':        { 'pt-PT': 'Ranking ELO',           'pt-BR': 'Ranking ELO' },

  // ── /picks ─────────────────────────────────────────────────────────────
  'picks.title':             { 'pt-PT': 'Picks do dia',          'pt-BR': 'Palpites do dia' },
  'picks.subtitle':          { 'pt-PT': 'Apostas com edge positivo segundo o modelo ELO próprio.',
                               'pt-BR': 'Apostas com edge positivo segundo o modelo ELO próprio.' },
  'picks.empty.title':       { 'pt-PT': 'Sem picks publicados hoje',
                               'pt-BR': 'Sem palpites publicados hoje' },
  'picks.empty.text':        { 'pt-PT': 'O modelo só publica quando encontra edge ≥ 5%. Volta amanhã.',
                               'pt-BR': 'O modelo só publica quando encontra edge ≥ 5%. Volte amanhã.' },
  'picks.yesterday':         { 'pt-PT': 'Resultados de ontem',   'pt-BR': 'Resultados de ontem' },
  'picks.live':              { 'pt-PT': 'AO VIVO',               'pt-BR': 'AO VIVO' },
  'picks.bet_at':            { 'pt-PT': 'Apostar @',             'pt-BR': 'Apostar @' },
  'picks.edge':              { 'pt-PT': 'Edge',                  'pt-BR': 'Edge' },

  // ── /jogadores ───────────────────────────────────────────────────────────
  'players.title':           { 'pt-PT': 'Jogadores',              'pt-BR': 'Jogadores' },
  'players.subtitle':        { 'pt-PT': 'Perfis completos com ELO próprio por superfície, forma recente, head-to-head e histórico.',
                               'pt-BR': 'Perfis completos com ELO próprio por piso, forma recente, head-to-head e histórico.' },
  'players.atp':             { 'pt-PT': 'ATP — Masculino',        'pt-BR': 'ATP — Masculino' },
  'players.wta':             { 'pt-PT': 'WTA — Feminino',         'pt-BR': 'WTA — Feminino' },
  'players.see_ranking':     { 'pt-PT': 'Ver ranking ELO completo →',
                               'pt-BR': 'Ver ranking ELO completo →' },

  // ── /ranking ────────────────────────────────────────────────────────────
  'ranking.title':           { 'pt-PT': 'Ranking ELO',            'pt-BR': 'Ranking ELO' },
  'ranking.subtitle':        { 'pt-PT': 'Modelo próprio · atualizado diariamente · cobertura ATP + WTA',
                               'pt-BR': 'Modelo próprio · atualizado diariamente · cobertura ATP + WTA' },
  'ranking.delta_30d':       { 'pt-PT': 'Δ 30d',                  'pt-BR': 'Δ 30d' },
  'ranking.form':            { 'pt-PT': 'Forma',                  'pt-BR': 'Forma' },
  'ranking.top10':           { 'pt-PT': 'Top 10',                 'pt-BR': 'Top 10' },

  // ── /torneios ───────────────────────────────────────────────────────────
  'tournaments.title':       { 'pt-PT': 'Calendário de Torneios', 'pt-BR': 'Calendário de Torneios' },
  'tournaments.subtitle':    { 'pt-PT': 'ATP + WTA · resultados oficiais e previsões ELO',
                               'pt-BR': 'ATP + WTA · resultados oficiais e previsões ELO' },
  'tournaments.all':         { 'pt-PT': 'Todos',                  'pt-BR': 'Todos' },
  'tournaments.empty':       { 'pt-PT': 'Nenhum torneio encontrado',
                               'pt-BR': 'Nenhum torneio encontrado' },
  'tournaments.empty_hint':  { 'pt-PT': 'Tenta ajustar os filtros.',
                               'pt-BR': 'Tente ajustar os filtros.' },

  // ── Tournament page ─────────────────────────────────────────────────────
  'tournament.dates':        { 'pt-PT': 'Datas',                  'pt-BR': 'Datas' },
  'tournament.prize':        { 'pt-PT': 'Premiação',              'pt-BR': 'Premiação' },
  'tournament.draw':         { 'pt-PT': 'Quadro',                 'pt-BR': 'Chave' },
  'tournament.category':     { 'pt-PT': 'Categoria',              'pt-BR': 'Categoria' },
  'tournament.summary':      { 'pt-PT': 'Resumo do torneio',      'pt-BR': 'Resumo do torneio' },
  'tournament.back':         { 'pt-PT': '← Voltar ao calendário', 'pt-BR': '← Voltar ao calendário' },
  'tournament.see_ranking':  { 'pt-PT': '🏆 Ver Ranking ELO',     'pt-BR': '🏆 Ver Ranking ELO' },
  'tournament.scatter.title':{ 'pt-PT': 'Quem está mais preparado para {surface}?',
                               'pt-BR': 'Quem está mais preparado para {surface}?' },

  // ── /h2h ────────────────────────────────────────────────────────────────
  'h2h.title':               { 'pt-PT': 'Head-to-Head',           'pt-BR': 'Head-to-Head' },
  'h2h.subtitle':             { 'pt-PT': 'Confronto entre dois jogadores · probabilidades pelo modelo ELO.',
                                'pt-BR': 'Confronto entre dois jogadores · probabilidades pelo modelo ELO.' },

  // ── Footer ──────────────────────────────────────────────────────────────
  'footer.about':            { 'pt-PT': 'Sobre o modelo',         'pt-BR': 'Sobre o modelo' },
  'footer.responsible':      { 'pt-PT': 'Joga responsável',       'pt-BR': 'Jogue com responsabilidade' },
  'footer.rights':           { 'pt-PT': 'Todos os direitos reservados',
                               'pt-BR': 'Todos os direitos reservados' },
} as const;

type DictKey = keyof typeof dict;

/**
 * Translate. Falls back to pt-PT if the BR variant is missing for the key.
 * Supports {placeholder} substitution.
 */
export function t(
  locale: Locale,
  key: DictKey,
  vars?: Record<string, string | number>
): string {
  const entry = dict[key];
  let s = (entry?.[locale] as string | undefined) ?? entry?.['pt-PT'] ?? String(key);
  if (vars) {
    for (const [k, v] of Object.entries(vars)) {
      s = s.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
    }
  }
  return s;
}

/**
 * Localized link href. Prefixes /br/ for pt-BR (except for `/` which becomes
 * `/br`). pt-PT keeps URLs as-is (canonical).
 */
export function localizedHref(locale: Locale, href: string): string {
  if (locale === 'pt-PT') return href;
  if (href === '/') return '/br';
  if (href.startsWith('/br')) return href;
  return `/br${href}`;
}

/**
 * Strip the locale prefix from a pathname to get the "canonical" path
 * (without /br). Used for hreflang alternates.
 */
export function stripLocalePrefix(pathname: string): string {
  if (pathname === '/br') return '/';
  if (pathname.startsWith('/br/')) return pathname.slice(3);
  return pathname;
}

/**
 * Server-only: lê locale do header x-locale (injectado pelo middleware).
 */
export async function getLocale(): Promise<Locale> {
  const { headers } = await import('next/headers');
  const h = await headers();
  return h.get('x-locale') === 'pt-BR' ? 'pt-BR' : 'pt-PT';
}

/**
 * Helper centralizado para labels de surfaces, com diferenciação PT/BR.
 *   - pt-PT: Hard / Terra batida / Relvado
 *   - pt-BR: Hard / Saibro / Grama
 *
 * Indoor e Carpet são mapeados para "Hard" — não expomos estas surfaces
 * separadamente na UI (pouquíssima actividade no calendário).
 */
export function surfaceLabel(locale: Locale, surface: string | null | undefined): string {
  const s = (surface ?? '').toLowerCase();
  if (s === 'clay')   return locale === 'pt-BR' ? 'Saibro'  : 'Terra batida';
  if (s === 'grass')  return locale === 'pt-BR' ? 'Grama'   : 'Relvado';
  if (s === 'hard' || s === 'indoor' || s === 'carpet') return 'Hard';
  return surface ?? '';
}

/**
 * Helper para `generateMetadata`: devolve canonical + alternates correctos.
 */
export function hreflangAlternates(canonicalPath: string) {
  const base = 'https://tudotenis.com';
  const ptPath = canonicalPath;
  const brPath = canonicalPath === '/' ? '/br' : `/br${canonicalPath}`;
  return {
    canonical: `${base}${ptPath}`,
    languages: {
      'pt-PT': `${base}${ptPath}`,
      'pt-BR': `${base}${brPath}`,
      'x-default': `${base}${ptPath}`,
    },
  };
}
