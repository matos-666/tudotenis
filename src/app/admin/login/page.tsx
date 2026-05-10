import { LoginForm } from './LoginForm';

export const metadata = {
  title: 'Admin · Login',
  robots: { index: false, follow: false },
};

export default async function AdminLoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next = '/admin' } = await searchParams;

  return (
    <main className="min-h-screen flex items-center justify-center bg-[var(--color-surface)] p-4">
      <div className="w-full max-w-sm stat-card p-6">
        <h1 className="text-xl font-bold mb-1">Admin</h1>
        <p className="text-sm text-gray-500 mb-5">Acesso restrito</p>
        <LoginForm next={next} />
      </div>
    </main>
  );
}
