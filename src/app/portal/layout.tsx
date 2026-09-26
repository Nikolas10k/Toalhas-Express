import { Logo } from '@/components/logo';
import { LogoutButton } from '@/components/logout-button';
import { requirePageActor } from '@/server/auth/guards';

/** Portal do cliente: mobile first. Somente dados do próprio cliente. */
export default async function PortalLayout({ children }: { children: React.ReactNode }) {
  await requirePageActor('portal.access', '/portal');
  return (
    <div className="mx-auto min-h-screen max-w-2xl px-4 pb-10">
      <header className="flex h-14 items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo size={32} />
          <p className="font-bold">Toalhas Express</p>
        </div>
        <LogoutButton compact />
      </header>
      <main>{children}</main>
    </div>
  );
}
