'use client';

/**
 * Pequeno client island que força router.refresh() a cada intervalMs
 * enquanto a aba está visível. Usado nas páginas de match live para
 * que score/odds/stats se actualizem sem o user fazer F5.
 */
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';

export default function AutoRefresh({ intervalMs = 25000 }: { intervalMs?: number }) {
  const router = useRouter();
  useEffect(() => {
    const tick = () => {
      if (document.visibilityState === 'visible') router.refresh();
    };
    const id = setInterval(tick, intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);
  return null;
}
