'use client';

/**
 * Avatar de jogador unificado para toda a app.
 *
 * Camadas (de baixo para cima):
 *   1. Gradiente accent (sempre) — nunca há círculo vazio
 *   2. Iniciais (último recurso quando não há flag nem foto)
 *   3. Bandeira(s) reais estilo Flashscore (flagcdn.com) quando há flag
 *      mas não há foto — o código ISO é derivado do emoji guardado na
 *      DB (cada flag emoji são 2 regional indicators = ISO 3166 alpha-2)
 *   4. Foto do jogador quando existe (flag pequena no canto)
 *
 * Se qualquer imagem falhar (404/CORS), a camada de baixo fica visível.
 * Duplas passam 2 emoji ('🇨🇳🇫🇷') → círculo dividido em 2 metades.
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

// '🇫🇷' → ['fr'], '🇨🇳🇫🇷' → ['cn', 'fr']. Cada flag emoji são dois
// regional indicator symbols (U+1F1E6..U+1F1FF) que mapeiam 1:1 para
// letras ISO 3166-1 alpha-2 — conversão determinística, sem lookup.
function isoCodesFromEmojiFlags(s: string): string[] {
  const codes: string[] = [];
  const cps = Array.from(s);
  for (let i = 0; i < cps.length - 1; i++) {
    const a = cps[i].codePointAt(0) ?? 0;
    const b = cps[i + 1].codePointAt(0) ?? 0;
    if (a >= 0x1f1e6 && a <= 0x1f1ff && b >= 0x1f1e6 && b <= 0x1f1ff) {
      codes.push(String.fromCharCode(a - 0x1f1e6 + 97, b - 0x1f1e6 + 97));
      i++;
    }
  }
  return codes;
}

const hideOnError = (e: React.SyntheticEvent<HTMLImageElement>) => {
  e.currentTarget.style.display = 'none';
};

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
  const isoCodes = flag ? isoCodesFromEmojiFlags(flag).slice(0, 2) : [];
  const cornerPx = Math.max(10, Math.round(size * 0.34));

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
      {/* Iniciais — camada base, visível só se flag/foto falharem */}
      <span
        className="absolute inset-0 flex items-center justify-center font-extrabold tracking-tight text-[var(--color-accent)]"
        style={{ fontSize: fontPx, lineHeight: 1 }}
        aria-hidden="true"
      >
        {initials}
      </span>

      {/* Bandeira(s) reais a preencher o círculo (fallback sem foto).
          1 flag: cobre tudo; 2 flags (duplas): metade esquerda/direita. */}
      {!showImg && isoCodes.length > 0 && (
        <span className="absolute inset-0 flex" aria-hidden="true">
          {isoCodes.map((code, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`${code}-${i}`}
              src={`https://flagcdn.com/h80/${code}.png`}
              alt=""
              loading="lazy"
              onError={hideOnError}
              className="h-full object-cover"
              style={{ width: isoCodes.length > 1 ? '50%' : '100%' }}
            />
          ))}
        </span>
      )}

      {/* Foto do jogador — camada de topo */}
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

      {/* Mini-bandeira(s) no canto quando há foto */}
      {showImg && isoCodes.length > 0 && (
        <span
          className="absolute right-0 bottom-0 flex overflow-hidden rounded-tl bg-[var(--color-surface)] z-10"
          style={{ height: Math.round(cornerPx * 0.72) }}
          aria-hidden="true"
        >
          {isoCodes.map((code, i) => (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              key={`c-${code}-${i}`}
              src={`https://flagcdn.com/h24/${code}.png`}
              alt=""
              loading="lazy"
              onError={hideOnError}
              className="h-full w-auto"
            />
          ))}
        </span>
      )}
    </div>
  );
}
