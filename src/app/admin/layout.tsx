import { ShieldCheck } from 'lucide-react';
import { AdminSidebar } from '@/components/admin/sidebar';
import { ADMIN_NAV } from '@/components/admin/nav-config';
import { Logo } from '@/components/logo';
import { LogoutButton } from '@/components/logout-button';
import { Badge } from '@/components/ui/badge';
import { requirePageActor } from '@/server/auth/guards';

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const actor = await requirePageActor('admin.access', '/admin');
  const sections = ADMIN_NAV.map((s) => ({ ...s, items: s.items.filter((i) => actor.permissions.has(i.permission)) })).filter(
    (s) => s.items.length > 0,
  );

  return (
    <div className="flex min-h-screen">
      <aside className="hidden w-64 shrink-0 border-r bg-card px-3 py-5 lg:block">
        <div className="mb-6 flex items-center gap-3 px-3">
          <Logo size={40} />
          <p className="text-base font-bold tracking-tight">Toalhas Express</p>
        </div>
        <AdminSidebar sections={sections} />
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center justify-between border-b bg-card px-4 lg:px-6">
          <div className="flex items-center gap-2 lg:hidden">
            <Logo size={32} />
            <p className="font-semibold">Toalhas Express</p>
          </div>
          <div className="ml-auto flex items-center gap-3 text-sm">
            {actor.mfa.aal === 'aal2' && (
              <Badge variant="success" title="Sessão verificada com autenticador">
                <ShieldCheck className="size-3" aria-hidden /> MFA
              </Badge>
            )}
            <span className="hidden text-muted-foreground sm:inline">{actor.email}</span>
            <LogoutButton compact />
          </div>
        </header>
        <main className="flex-1 px-4 py-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
