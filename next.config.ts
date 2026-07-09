import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  images: {
    // Cloudflare (OpenNext) não corre o optimizer de imagens do Next da
    // mesma forma que a Vercel. As imagens do app são externas (Wikipedia,
    // flagcdn, Supabase Storage) com fallback garantido no PlayerAvatar,
    // por isso servir sem optimizer não tem regressão visual e evita a
    // fricção nº1 da migração. (Reactivar via Cloudflare Images é um
    // follow-up opcional.)
    unoptimized: true,
    remotePatterns: [
      { protocol: 'https', hostname: 'commons.wikimedia.org', pathname: '/wiki/Special:FilePath/**' },
      { protocol: 'https', hostname: 'upload.wikimedia.org' },
    ],
  },
  compress: true,
};

export default nextConfig;

// Dev com bindings Cloudflare (seguro se não houver bindings — o app usa
// Supabase por HTTP, não bindings CF). Permite `next dev` continuar igual.
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
initOpenNextCloudflareForDev();
