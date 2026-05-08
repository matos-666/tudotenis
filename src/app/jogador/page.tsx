import { redirect } from 'next/navigation';

/**
 * /jogador (sem slug) → redirect para o índice /jogadores.
 * Evita 404 quando alguém tenta visitar a raiz singular.
 */
export default function JogadorIndexPage() {
  redirect('/jogadores');
}
