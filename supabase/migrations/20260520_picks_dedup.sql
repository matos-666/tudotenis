-- 20260520_picks_dedup.sql
-- Previne picks duplicados no mesmo dia para o mesmo match.
--
-- O TennisStats embute um match-id único no URL h2h (e.g.
-- /h2h/sinner-vs-zverev-576276). Guardamos esse slug, e a constraint
-- impede 2 picks com o mesmo slug no mesmo dia.
--
-- Causa raiz dos duplicados: dedup actual é em memória, por cron run.
-- Quando o cron Vercel (06:30) e o GitHub Action (depois) correm em
-- janelas muito próximas, ambos leem o existingSet antes do outro
-- inserir → ambos criam o pick. Constraint a nível DB resolve.
--
-- Nota técnica: `posted_at::date` não é IMMUTABLE (depende do timezone
-- da sessão Postgres). Para o índice funcional, forçamos UTC com
-- `timezone('UTC', posted_at)::date` que É immutable.

alter table picks
  add column if not exists tennisstats_slug text;

drop index if exists picks_tennisstats_dedup_idx;

create unique index picks_tennisstats_dedup_idx
  on picks ((timezone('UTC', posted_at)::date), tennisstats_slug)
  where tennisstats_slug is not null;
