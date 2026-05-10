'use client';

import { useState, useTransition } from 'react';
import { loginAction } from './actions';

export function LoginForm({ next }: { next: string }) {
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();

  return (
    <form
      action={(fd) =>
        start(async () => {
          setError(null);
          const res = await loginAction(fd);
          if (res?.error) setError(res.error);
        })
      }
      className="flex flex-col gap-3"
    >
      <input type="hidden" name="next" value={next} />
      <input
        type="password"
        name="password"
        autoFocus
        autoComplete="current-password"
        placeholder="Password"
        required
        className="w-full px-3 py-2 rounded-lg bg-[var(--color-card)] border border-[var(--color-border)] focus:border-[var(--color-accent)] outline-none"
      />
      <button
        type="submit"
        disabled={pending}
        className="w-full py-2 rounded-lg bg-[var(--color-accent)] text-black font-semibold disabled:opacity-50"
      >
        {pending ? 'A entrar…' : 'Entrar'}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
