'use client';

/**
 * Avatar de jogador unificado para toda a app.
 *
 * - Tenta carregar `photoUrl`; se o load falhar (404, CORS, timeout),
 *   automaticamente cai para fallback de iniciais sobre gradiente
 *   accent — assim "garante que não falta imagem de jogador nenhum"
 *   mesmo quando o link da foto está partido.
 * - Tamanho controlado por `size` (px) — usado em listings (28-36px),
 *   scoreboards (40-48px) e cards (32-40px).
 * - Bandeira opcional sobreposta canto inferior direito.
 * - Borda subtil + ring no hover para profundidade quando dentro de
 *   cards interactivos.
 */
import { useState } from 'react';

interface Props {
  photoUrl?: string | null;
  name: string;
  flag?: string | null;
  size?: number;
  ring?: boolean;
}

function initialsOf(name: string): string {
  const parts = name.replace(/,/g, '').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '·';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

export default function PlayerAvatar({
  photoUrl,
  name,
  flag,
  size = 36,
  ring = false,
}: Props) {
  const [broken, setBroken] = useState(false);
  const showImg = photoUrl && !broken;
  const initials = initialsOf(name);
  const fontPx = Math.max(10, Math.round(size * 0.36));
  const flagPx = Math.max(8, Math.round(size * 0.22));

  // Estratégia: renderizamos SEMPRE um underlay sobre gradiente accent.
  // Se houver photoUrl, sobrepomos o <img> por cima.
  // - Carrega OK → tapa o underlay (parece foto)
  // - 404/CORS/timeout → onError esconde o img e o underlay fica visível
  // - Lento a carregar → underlay visível durante o load
  // Underlay: bandeira(s) grande(s) centrada(s) quando existem — mais
  // reconhecível que siglas (pedido do user); iniciais só como último
  // recurso quando nem flag há. Nunca há "círculo vazio".
  // Duplas podem passar 2 emoji ("🇨🇳🇫🇷") — reduzimos o font-size.
  const flagCount = flag ? Math.max(1, Math.round(Array.from(flag).length / 2)) : 0;
  const flagFallbackPx = Math.max(12, Math.round(size * (flagCount > 1 ? 0.30 : 0.48)));
  return (
    <div
      className={`relative rounded-full overflow-hidden flex-shrink-0 ${
        ring ? 'ring-1 ring-[var(--color-border)]/60' : ''
      }`}
      style={{
        width: size,
        height: size,
        background:
          'linear-gradient(135deg, color-mix(in srgb, var(--color-accent) 32%, var(--color-surface)) 0%, color-mix(in srgb, var(--color-accent) 12%, var(--color-surface)) 100%)',
      }}
    >
      {flag ? (
        <span
          className="absolute inset-0 flex items-center justify-center leading-none"
          style={{ fontSize: flagFallbackPx }}
          aria-hidden="true"
        >
          {flag}
        </span>
      ) : (
        <span
          className="absolute inset-0 flex items-center justify-center font-extrabold tracking-tight text-[var(--color-accent)]"
          style={{ fontSize: fontPx, lineHeight: 1 }}
          aria-hidden="true"
        >
          {initials}
        </span>
      )}
      {showImg && (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={photoUrl as string}
          alt={name}
          loading="lazy"
          onError={() => setBroken(true)}
          className="absolute inset-0 w-full h-full object-cover"
          style={{ objectPosition: 'top center' }}
        />
      )}
      {flag && showImg && (
        <span
          className="absolute right-0 bottom-0 leading-none bg-[var(--color-surface)] rounded-tl px-[1px] z-10"
          style={{ fontSize: flagPx }}
          aria-hidden="true"
        >
          {flag}
        </span>
      )}
    </div>
  );
}
