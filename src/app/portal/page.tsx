import { CalendarClock, FileText, Package, ShoppingBag, UserCog, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requirePageActor } from '@/server/auth/guards';
import { getOwnCustomer } from '@/server/modules/customers/customers.service';
import { getOwnBalances } from '@/server/modules/inventory/inventory.service';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Portal do cliente' };

const SHORTCUTS = [
  { label: 'Novo pedido', icon: ShoppingBag, href: null },
  { label: 'Meus pedidos', icon: FileText, href: null },
  { label: 'Minhas toalhas', icon: Package, href: '/portal/toalhas' },
  { label: 'Financeiro', icon: Wallet, href: null },
  { label: 'Meus dados', icon: UserCog, href: '/portal/meus-dados' },
];

export default async function PortalHome() {
  const actor = await requirePageActor('portal.access', '/portal');
  const customer = await getOwnCustomer(actor).catch(() => null);
  const balances = customer ? await getOwnBalances(actor).catch(() => []) : [];
  const towels = balances.reduce((a, b) => a + b.quantity, 0);

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold">Olá{customer ? `, ${customer.tradeName ?? customer.legalName}` : ''}</h1>
      {!customer && <Alert>Seu usuário ainda não está vinculado a um cadastro de cliente. Fale com a Toalhas Express.</Alert>}
      {customer?.status === 'pending' && (
        <Alert>Seu cadastro está em análise. Assim que for aprovado, você poderá fazer pedidos por aqui.</Alert>
      )}
      {customer?.status === 'suspended' && (
        <Alert variant="destructive">Seu cadastro está suspenso. Entre em contato com a Toalhas Express.</Alert>
      )}

      <div className="grid grid-cols-2 gap-3">
        {[
          { t: 'Próxima entrega', v: '—', icon: CalendarClock },
          { t: 'Toalhas em posse', v: customer ? String(towels) : '—', icon: Package },
          { t: 'Pedido atual', v: '—', icon: ShoppingBag },
          { t: 'Cobranças em aberto', v: '—', icon: Wallet },
        ].map((c) => (
          <Card key={c.t}>
            <CardHeader className="p-4 pb-1">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <c.icon className="size-4" aria-hidden /> {c.t}
              </CardTitle>
            </CardHeader>
            <CardContent className="p-4 pt-0 text-2xl font-semibold">{c.v}</CardContent>
          </Card>
        ))}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
        {SHORTCUTS.map((s) => {
          const content = (
            <>
              <s.icon className="size-6 text-primary" aria-hidden />
              <span className="text-sm font-medium">{s.label}</span>
              {!s.href && <span className="text-xs text-muted-foreground">em breve</span>}
            </>
          );
          const cls = cn('flex flex-col items-center gap-1 rounded-lg border bg-card p-4 text-center', s.href ? 'hover:bg-accent' : 'opacity-60');
          return s.href ? (
            <Link key={s.label} href={s.href} className={cls}>
              {content}
            </Link>
          ) : (
            <div key={s.label} className={cls} aria-disabled="true">
              {content}
            </div>
          );
        })}
      </div>
    </div>
  );
}
