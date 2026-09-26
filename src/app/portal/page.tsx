import { CalendarClock, FileText, Package, ShoppingBag, UserCog, Wallet } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { requirePageActor } from '@/server/auth/guards';
import { getOwnCustomer } from '@/server/modules/customers/customers.service';
import { getOwnBalances } from '@/server/modules/inventory/inventory.service';
import { listOwnOrders } from '@/server/modules/orders/orders.service';
import { ORDER_STATUS_LABEL, formatScheduleDate } from '@/components/orders/labels';
import { cn } from '@/lib/utils';

export const metadata: Metadata = { title: 'Portal do cliente' };

const SHORTCUTS = [
  { label: 'Novo pedido', icon: ShoppingBag, href: '/portal/pedidos/novo' },
  { label: 'Meus pedidos', icon: FileText, href: '/portal/pedidos' },
  { label: 'Minhas toalhas', icon: Package, href: '/portal/toalhas' },
  { label: 'Financeiro', icon: Wallet, href: null },
  { label: 'Meus dados', icon: UserCog, href: '/portal/meus-dados' },
];

export default async function PortalHome() {
  const actor = await requirePageActor('portal.access', '/portal');
  const customer = await getOwnCustomer(actor).catch(() => null);
  const balances = customer ? await getOwnBalances(actor).catch(() => []) : [];
  const towels = balances.reduce((a, b) => a + b.quantity, 0);
  const orders = customer ? await listOwnOrders(actor).catch(() => []) : [];
  const open = orders.filter((o) => !['CANCELLED', 'COMPLETED', 'DELIVERED'].includes(o.status));
  // Lista vem por data desc: o pedido aberto mais próximo é o último.
  const current = open.at(-1);
  const nextDelivery = open.filter((o) => o.type !== 'COLLECTION' && o.status !== 'DRAFT').at(-1);

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
          { t: 'Próxima entrega', v: nextDelivery ? formatScheduleDate(nextDelivery.scheduledDate).slice(0, 5) : '—', icon: CalendarClock, href: nextDelivery ? `/portal/pedidos/${nextDelivery.id}` : null },
          { t: 'Toalhas em posse', v: customer ? String(towels) : '—', icon: Package, href: '/portal/toalhas' },
          { t: 'Pedido atual', v: current ? (ORDER_STATUS_LABEL[current.status] ?? current.status) : '—', icon: ShoppingBag, href: current ? `/portal/pedidos/${current.id}` : null },
          { t: 'Cobranças em aberto', v: '—', icon: Wallet, href: null },
        ].map((c) => (
          <Card key={c.t} className={cn('relative', c.href && 'hover:bg-accent')}>
            <CardHeader className="p-4 pb-1">
              <CardTitle className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                <c.icon className="size-4" aria-hidden />
                {c.href ? (
                  <Link href={c.href} className="after:absolute after:inset-0">
                    {c.t}
                  </Link>
                ) : (
                  c.t
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className={cn('p-4 pt-0 font-semibold', c.v.length > 8 ? 'text-lg' : 'text-2xl')}>{c.v}</CardContent>
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
