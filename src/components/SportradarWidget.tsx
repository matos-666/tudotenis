'use client';

/**
 * Wrapper para os widgets oficiais da Sportradar (versão betradar grátis).
 *
 * Loader injectado UMA vez na primeira mount; subsequentes widgets
 * reutilizam o script. Cleanup remove o container ao unmount mas
 * preserva o loader para reuse.
 *
 * Branding Betradar é obrigatório (vem dentro do widget). Cookies de
 * tracking — declarar em privacy.
 */
import { useEffect, useRef } from 'react';

const LOADER_SRC = 'https://widgets.sir.sportradar.com/betradar/widgetloader';
const LOADER_ID = 'sr-widgetloader';

type WidgetType =
  | 'match.lmtPlus'
  | 'match.lmtCompact'
  | 'match.lmtLight'
  | 'match.scoreboard'
  | 'match.statistics'
  | 'match.commentary'
  | 'match.winProbability'
  | 'match.momentum'
  | 'match.matchList'
  | 'season.cupRoster';

interface Props {
  widget: WidgetType;
  matchId?: number;
  seasonId?: number;
  language?: 'pt' | 'en' | 'es';
  className?: string;
}

export function SportradarWidget({
  widget,
  matchId,
  seasonId,
  language = 'pt',
  className,
}: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let cancelled = false;

    const ensureLoader = (): Promise<void> => {
      if (document.getElementById(LOADER_ID)) return Promise.resolve();
      return new Promise((resolve, reject) => {
        const s = document.createElement('script');
        s.id = LOADER_ID;
        s.src = LOADER_SRC;
        s.async = true;
        s.dataset.srLanguage = language;
        s.onload = () => resolve();
        s.onerror = () => reject(new Error('sr-loader-failed'));
        document.head.appendChild(s);
      });
    };

    ensureLoader()
      .then(() => {
        if (cancelled || !ref.current) return;
        // After loader runs, window.SIR is the entry point
        const w = window as unknown as { SIR?: (cmd: string, el: string | HTMLElement, name: string, opts: Record<string, unknown>) => void };
        if (typeof w.SIR === 'function') {
          const opts: Record<string, unknown> = {};
          if (matchId) opts.matchId = matchId;
          if (seasonId) opts.seasonId = seasonId;
          w.SIR('addWidget', ref.current, widget, opts);
        }
      })
      .catch(() => {
        // soft fail; widget won't render but page survives
      });

    return () => {
      cancelled = true;
      if (ref.current) ref.current.innerHTML = '';
    };
  }, [widget, matchId, seasonId, language]);

  return <div ref={ref} className={className} />;
}
