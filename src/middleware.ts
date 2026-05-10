/**
 * Middleware Edge: protege /admin/* (excepto /admin/login).
 *
 * Nota: middleware corre em Edge runtime — não pode importar `crypto`
 * Node nem `cookies()` from next/headers. Verificação simples aqui:
 * existe cookie? Não está vazio? A validação completa (HMAC) acontece
 * no layout server component via isAdminAuthed().
 *
 * Esta camada apenas redireciona requests sem cookie para /admin/login.
 * Defesa em profundidade: o layout valida HMAC.
 */
import { NextResponse, type NextRequest } from 'next/server';

const ADMIN_COOKIE_NAME = 'tt-admin';

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Só /admin/* — login e API à parte
  if (!pathname.startsWith('/admin')) return NextResponse.next();
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

  return NextResponse.next();
}

export const config = {
  matcher: ['/admin/:path*'],
};
