# TudoTénis 🎾

Modelo ELO + estatísticas avançadas de ténis em português · ATP, WTA, Challengers e ITF.

🌐 **Live**: https://tudotenis.vercel.app

## Stack

- **Frontend**: Next.js 16 (App Router) · React 19 · Tailwind 4 · TypeScript
- **Database**: Supabase (Postgres + RLS)
- **Hosting**: Vercel (ISR + Edge CDN)
- **Modelo ELO**: proprietário, treinado em 40k+ jogos desde 1968

## Páginas

- `/` — Homepage com hero + KPIs
- `/ranking` — Ranking ELO ATP/WTA top 10
- `/jogador/[slug]` — 33 perfis SSG (Sinner, Alcaraz, Sabalenka, Swiatek...)

## Performance

- ✅ 33 páginas estáticas geradas em build
- ✅ ISR 1h revalidação (sempre dados frescos sem rebuild)
- ✅ SEO: hreflang PT-BR/PT-PT, JSON-LD Organization+Person+WebSite, OG tags

## Setup local

```bash
npm install
# preencher .env.local com keys Supabase
npm run dev   # http://localhost:3000
```

## Auto-deploy

Cada `git push` ao branch `main` faz automaticamente:
1. Vercel build (Turbopack)
2. ISR pages re-geradas
3. Deploy zero-downtime ao edge global
