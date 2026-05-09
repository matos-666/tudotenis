/**
 * Helpers para JSON-LD structured data.
 * Cada função retorna o objecto JSON-LD pronto a serializar.
 */

const BASE = process.env.NEXT_PUBLIC_SITE_URL || 'https://tudotenis.com';

export interface BreadcrumbItem {
  name: string;
  href: string;
}

/**
 * BreadcrumbList — aparece no Google como migalhas em vez do URL inteiro.
 * Aceita array de [{ name, href }] e gera position 1..N.
 *
 * Use:
 *   <script type="application/ld+json"
 *     dangerouslySetInnerHTML={{ __html: JSON.stringify(breadcrumbJsonLd([...])) }} />
 */
export function breadcrumbJsonLd(items: BreadcrumbItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((it, i) => ({
      '@type': 'ListItem',
      position: i + 1,
      name: it.name,
      item: `${BASE}${it.href}`,
    })),
  };
}

export interface FAQItem {
  question: string;
  answer: string;
}

/**
 * FAQPage — habilita "rich results" em queries de pergunta.
 */
export function faqJsonLd(items: FAQItem[]) {
  return {
    '@context': 'https://schema.org',
    '@type': 'FAQPage',
    mainEntity: items.map(it => ({
      '@type': 'Question',
      name: it.question,
      acceptedAnswer: {
        '@type': 'Answer',
        text: it.answer,
      },
    })),
  };
}

export interface SportsEventInput {
  name: string;
  url: string;
  startDate?: string | null;
  endDate?: string | null;
  location?: string | null;
  surface?: string | null;
  status?: string | null;
}

/**
 * SportsEvent — torneios em rich results de eventos.
 */
export function sportsEventJsonLd(t: SportsEventInput) {
  const status = t.status === 'live'
    ? 'https://schema.org/EventScheduled'
    : t.status === 'finished'
    ? 'https://schema.org/EventCompleted'
    : 'https://schema.org/EventScheduled';
  return {
    '@context': 'https://schema.org',
    '@type': 'SportsEvent',
    name: t.name,
    url: t.url,
    sport: 'Tennis',
    eventStatus: status,
    startDate: t.startDate,
    endDate: t.endDate,
    location: t.location ? {
      '@type': 'Place',
      name: t.location,
    } : undefined,
    description: t.surface
      ? `${t.name} — torneio profissional de ténis em ${t.surface}.`
      : t.name,
  };
}

/**
 * Itera para criar JSON-LD inline tag.
 */
export function jsonLdScript(data: unknown) {
  return JSON.stringify(data);
}
