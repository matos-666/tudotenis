import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';
import { themeInitScript } from '@/components/ThemeToggle';
import { Analytics } from '@vercel/analytics/next';

const inter = Inter({
  subsets: ['latin', 'latin-ext'],
  variable: '--font-inter',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-jetbrains',
  display: 'swap',
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || 'https://tudotenis.com';

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: 'TudoTénis — Modelo ELO + Stats Avançadas | ATP, WTA, Challengers',
    template: '%s | TudoTénis',
  },
  description:
    'Picks ELO + estatísticas avançadas de ténis em português. Cobertura ATP, WTA, Challengers e ITF. Yield comprovado +27,6% · 439 tips auditadas · 2.557 jogadores.',
  keywords: [
    'ténis', 'tenis', 'picks', 'ELO', 'ATP', 'WTA', 'apostas', 'prognósticos',
    'Roland Garros', 'Wimbledon', 'US Open', 'Australian Open',
    'estatísticas tenis', 'predictor',
  ],
  authors: [{ name: 'TudoTénis' }],
  creator: 'TudoTénis',
  publisher: 'TudoTénis',
  formatDetection: { telephone: false, email: false, address: false },
  alternates: {
    canonical: siteUrl,
    languages: {
      'pt-BR': `${siteUrl}/br`,
      'pt-PT': `${siteUrl}/pt`,
      'x-default': siteUrl,
    },
  },
  openGraph: {
    type: 'website',
    url: siteUrl,
    siteName: 'TudoTénis',
    title: 'TudoTénis — Modelo ELO + Stats Avançadas',
    description:
      'Picks ELO + stats que ninguém mais publica em português. 59k jogos analisados, yield +27,6%.',
    locale: 'pt_BR',
    alternateLocale: ['pt_PT'],
    images: [
      {
        url: '/logo.png',
        width: 1200,
        height: 630,
        alt: 'TudoTénis',
      },
    ],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'TudoTénis — Modelo ELO + Stats',
    description: 'Picks ELO + stats avançadas de ténis em português. Yield +27,6%.',
    images: ['/logo.png'],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      'max-image-preview': 'large',
      'max-snippet': -1,
    },
  },
  verification: {
    google: 'E3w7dKw7_E1PxJIu_yewucr8cqLAto2KOwF2KWmGFCc',
  },
  icons: {
    // Ordem importa: navegadores (e Google) preferem o primeiro que entendam.
    // SVG primeiro = escala perfeita em qualquer tamanho do display.
    icon: [
      { url: '/favicon.svg', type: 'image/svg+xml' },
      { url: '/favicon.ico', type: 'image/x-icon', sizes: '16x16 32x32 48x48' },
      { url: '/favicon.png', type: 'image/png', sizes: '192x192' },
    ],
    apple: '/favicon.png',
  },
};

export const viewport: Viewport = {
  themeColor: '#0a0e0f',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  // IMPORTANTE: este layout é INTENCIONALMENTE síncrono e NÃO chama
  // headers(). Chamar headers() ou cookies() aqui obrigava TODAS as
  // rotas (incluindo SSG/ISR) a renderem como dynamic → Vercel emitia
  // `Cache-Control: no-store` em tudo, matando edge cache (~135 KB
  // descacheados em /picks por exemplo).
  //
  // Trade-off: o `<html lang>` fica fixo em pt-PT mesmo para /br/*.
  // Mitigação: um pequeno script inline corrige o lang no cliente
  // assim que o documento carrega. Para Google, o sinal definitivo
  // de idioma vem do `hreflang` no <head> + content language nas
  // metas das páginas /br/* — perfeitamente suficiente.
  return (
    <html lang="pt-PT" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`} suppressHydrationWarning>
      <head>
        {/* Theme init: aplica antes de pintar para evitar flash */}
        <script dangerouslySetInnerHTML={{ __html: themeInitScript }} />
        {/* Ajusta lang client-side em /br/* — preserva a11y/screen readers */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{if(location.pathname==='/br'||location.pathname.indexOf('/br/')===0){document.documentElement.lang='pt-BR'}}catch(e){}})()`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        {/* Skip-to-content (a11y) — texto neutro funciona em ambos os locales */}
        <a
          href="#main"
          className="absolute -top-10 left-0 bg-[var(--color-accent)] text-[var(--color-surface)] px-4 py-2 font-semibold z-[1000] focus:top-0 transition-all"
        >
          Saltar para o conteúdo principal
        </a>

        {/* JSON-LD: Organization */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'Organization',
              name: 'TudoTénis',
              url: siteUrl,
              logo: `${siteUrl}/logo.png`,
              description:
                'Modelo ELO próprio com 59k jogos analisados de ténis ATP, WTA, Challengers e ITF.',
            }),
          }}
        />

        {/* JSON-LD: WebSite + SearchAction */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              '@context': 'https://schema.org',
              '@type': 'WebSite',
              name: 'TudoTénis',
              url: siteUrl,
              potentialAction: {
                '@type': 'SearchAction',
                target: `${siteUrl}/search?q={search_term_string}`,
                'query-input': 'required name=search_term_string',
              },
            }),
          }}
        />

        {children}
        <Analytics />
      </body>
    </html>
  );
}
