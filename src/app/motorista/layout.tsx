import { LogoutButton } from '@/components/logout-button';
import { requirePageActor } from '@/server/auth/guards';

/** App do motorista: mobile first. Apenas rotas próprias, nada financeiro. */
export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  await requirePageActor('driver_app.access', '/motorista');
  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-10">
      <header className="flex h-14 items-center justify-between">
        <p className="font-bold text-primary">Minha rota</p>
        <LogoutButton compact />
      </header>
      <main>{children}</main>
    </div>
  );
}
