import type { MetadataRoute } from 'next';

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://tudotenis.com';

/**
 * /robots.txt dinâmico
 *
 * Política:
 * - Indexação aberta excepto /api/, /admin/, /_next/
 * - SEARCH bots dos LLMs (ChatGPT, Claude, Perplexity, etc.) → ALLOW
 *   Estes bots fazem retrieval em tempo real → presença em respostas AI
 * - TRAINING bots → BLOCK (opt-out de uso para treino de modelos)
 *
 * Distinção importante:
 *   GPTBot, ClaudeBot, CCBot, anthropic-ai = scrapers de treino   → BLOCK
 *   OAI-SearchBot, ChatGPT-User, PerplexityBot, ClaudeBot-User    → ALLOW
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/admin/', '/_next/'],
      },
      // ── AI search bots (retrieval em tempo real) — ALLOW ───────────────
      // Estes são usados quando o LLM responde a uma pergunta sobre ténis
      // em tempo real e procura conteúdo fresco. Bloqueá-los = invisível
      // em ChatGPT/Claude/Perplexity nas suas pesquisas.
      { userAgent: 'OAI-SearchBot', allow: '/' },
      { userAgent: 'ChatGPT-User', allow: '/' },
      { userAgent: 'PerplexityBot', allow: '/' },
      { userAgent: 'Perplexity-User', allow: '/' },
      { userAgent: 'ClaudeBot-User', allow: '/' },
      { userAgent: 'Claude-User', allow: '/' },
      { userAgent: 'Claude-SearchBot', allow: '/' },
      { userAgent: 'Google-Extended', allow: '/' },
      // ── Training / scraping bots — BLOCK ───────────────────────────────
      // Estes apenas extraem conteúdo para datasets de treino. Sem benefício
      // SEO/visibilidade, opt-out preserva o nosso conteúdo proprietário.
      { userAgent: 'GPTBot', disallow: '/' },
      { userAgent: 'CCBot', disallow: '/' },
      { userAgent: 'ClaudeBot', disallow: '/' },
      { userAgent: 'anthropic-ai', disallow: '/' },
      { userAgent: 'Bytespider', disallow: '/' },
      { userAgent: 'Amazonbot', disallow: '/' },
      { userAgent: 'FacebookBot', disallow: '/' },
      { userAgent: 'Applebot-Extended', disallow: '/' },
    ],
    sitemap: `${BASE}/sitemap.xml`,
    host: BASE,
  };
}
