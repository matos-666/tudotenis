import Link from 'next/link';
import { redirect } from 'next/navigation';
import { isAdminAuthed } from '@/lib/admin-auth';
import { logoutAction } from '../login/actions';

export const metadata = {
  title: 'Admin · TudoTénis',
  robots: { index: false, follow: false },
};

export const dynamic = 'force-dynamic';

const NAV = [
  { href: '/admin', label: 'Dashboard' },
  { href: '/admin/jogadores', label: 'Jogadores' },
  { href: '/admin/torneios', label: 'Torneios' },
  { href: '/admin/picks', label: 'Picks' },
  { href: '/admin/cron', label: 'Cron / Logs' },
  { href: '/admin/analytics', label: 'Analytics' },
];

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Login page é o seu próprio layout (sem sidebar)
  // — verificamos isto via children prop não funciona, então
  // simplesmente: se não auth, redireciona para login (excepto se já lá está,
  // caso em que não chegamos aqui porque /admin/login tem o seu próprio layout)

  const authed = await isAdminAuthed();
  if (!authed) redirect('/admin/login');

  return (
    <div className="min-h-screen flex flex-col md:flex-row">
      {/* Sidebar */}
      <aside className="md:w-56 border-b md:border-b-0 md:border-r border-[var(--color-border)] bg-[var(--color-card)] flex md:flex-col p-3 md:p-4 gap-1 overflow-x-auto md:overflow-visible">
        <div className="hidden md:block mb-4">
          <Link href="/" className="font-bold text-lg">
            <span>Tudo</span>
            <span className="text-[var(--color-accent)]">Ténis</span>
          </Link>
          <div className="text-xs text-gray-500">admin</div>
        </div>
        {NAV.map(item => (
          <Link
            key={item.href}
            href={item.href}
            className="px-3 py-2 rounded-lg hover:bg-[var(--color-surface)] text-sm whitespace-nowrap"
          >
            {item.label}
          </Link>
        ))}
        <form action={logoutAction} className="mt-auto hidden md:block pt-3 border-t border-[var(--color-border)]">
          <button
            type="submit"
            className="w-full text-left px-3 py-2 rounded-lg hover:bg-[var(--color-surface)] text-sm text-gray-500"
          >
            Logout
          </button>
        </form>
      </aside>

      {/* Main */}
      <main className="flex-1 p-4 md:p-8 max-w-6xl">{children}</main>
    </div>
  );
}
