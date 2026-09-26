import { Logo } from '@/components/logo';
import { LogoutButton } from '@/components/logout-button';
import { ServiceWorkerRegister } from '@/components/routes/sw-register';
import { requirePageActor } from '@/server/auth/guards';

/** App do motorista: mobile first. Apenas rotas próprias, nada financeiro. */
export default async function DriverLayout({ children }: { children: React.ReactNode }) {
  await requirePageActor('driver_app.access', '/motorista');
  return (
    <div className="mx-auto min-h-screen max-w-lg px-4 pb-10">
      <header className="flex h-14 items-center justify-between">
        <div className="flex items-center gap-2">
          <Logo size={32} />
          <p className="font-bold">Minha rota</p>
        </div>
        <LogoutButton compact />
      </header>
      <main>{children}</main>
      <ServiceWorkerRegister />
    </div>
  );
}
