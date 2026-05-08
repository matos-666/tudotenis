import type { Metadata, Viewport } from 'next';
import { Inter, JetBrains_Mono } from 'next/font/google';
import './globals.css';

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
    'Picks ELO + estatísticas avançadas de ténis em português. Cobertura ATP, WTA, Challengers e ITF. Yield comprovado +30,4% · 405 tips auditadas · 1.059 jogadores.',
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
      'Picks ELO + stats que ninguém mais publica em português. 40k+ jogos analisados, yield +30,4%.',
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
    description: 'Picks ELO + stats avançadas de ténis em português. Yield +30,4%.',
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
  icons: {
    icon: [
      { url: '/favicon.png', type: 'image/png', sizes: '512x512' },
      { url: '/favicon.svg', type: 'image/svg+xml' },
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
  return (
    <html lang="pt-BR" className={`${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">
        {/* Skip-to-content (a11y) */}
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
                'Modelo ELO próprio com 40k+ jogos analisados de ténis ATP, WTA, Challengers e ITF.',
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
      </body>
    </html>
  );
}
