/**
 * Middleware Edge — duas responsabilidades:
 *
 * 1. Protege /admin/* (excepto /admin/login). Defesa em profundidade —
 *    o layout valida HMAC; aqui só verifica existência do cookie.
 *
 * 2. Detecção de locale: pt-PT (default) e pt-BR (sob /br/*).
 *    Brasileiros (geo-IP=BR) que chegam sem cookie de locale e sem prefix
 *    /br/ são redireccionados para a versão BR. Bots, requests com cookie,
 *    e URLs com prefix explícito não são afectados.
 *
 *    Também propaga header `x-locale` para o layout consumir e setar o
 *    `<html lang="...">` correcto.
 */
import { NextResponse, type NextRequest } from 'next/server';

const ADMIN_COOKIE_NAME = 'tt-admin';
const LOCALE_COOKIE_NAME = 'tt-locale';

// Paths que ignoram o redirect BR (mantêm em pt-PT no /)
const LOCALE_SKIP = [
  '/admin', '/api', '/_next', '/favicon', '/robots.txt', '/sitemap',
  '/logo', '/opengraph-image', '.png', '.jpg', '.svg', '.ico', '.txt',
];

function getLocaleFromPath(pathname: string): 'pt-BR' | 'pt-PT' {
  if (pathname === '/br' || pathname.startsWith('/br/')) return 'pt-BR';
  return 'pt-PT';
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // ── 1. Admin auth ─────────────────────────────────────────────────────
  if (pathname.startsWith('/admin')) {
    if (pathname === '/admin/login' || pathname.startsWith('/admin/login/')) {
      return NextResponse.next();
    }
    const cookie = req.cookies.get(ADMIN_COOKIE_NAME)?.value;
    if (!cookie) {
      const url = req.nextUrl.clone();
      url.pathname = '/admin/login';
      url.searchParams.set('next', pathname);
      return NextResponse.redirect(url);
    }
    // continua para o handler — não aplica locale routing dentro de admin
    return NextResponse.next();
  }

  // ── 2. Locale routing ─────────────────────────────────────────────────
  const isSkipped = LOCALE_SKIP.some(p => pathname.startsWith(p) || pathname.endsWith(p));

  const currentLocale = getLocaleFromPath(pathname);
  // Propaga header para o layout setar <html lang>
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set('x-locale', currentLocale);

  // Se já está em /br/ ou em path que skipamos, segue
  if (currentLocale === 'pt-BR' || isSkipped) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Se utilizador já escolheu locale (cookie), respeita
  const localeCookie = req.cookies.get(LOCALE_COOKIE_NAME)?.value;
  if (localeCookie) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  // Detecção: geo-IP da Vercel (free) + Accept-Language fallback
  // Em Vercel Edge runtime, country vem no header x-vercel-ip-country.
  const country = req.headers.get('x-vercel-ip-country');
  const acceptLang = req.headers.get('accept-language') ?? '';
  const isBrazilian = country === 'BR' || /\bpt-BR\b/i.test(acceptLang);

  if (isBrazilian) {
    const url = req.nextUrl.clone();
    url.pathname = pathname === '/' ? '/br' : `/br${pathname}`;
    return NextResponse.redirect(url);
  }

  return NextResponse.next({ request: { headers: requestHeaders } });
}

export const config = {
  matcher: [
    /*
     * Aplica a quase tudo, excepto:
     *   - /_next/static (assets)
     *   - /_next/image (otimização)
     *   - /favicon.ico
     *
     * O middleware decide internamente se faz redirect ou só propaga header.
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
