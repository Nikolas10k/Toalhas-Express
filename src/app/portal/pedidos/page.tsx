import { ArrowLeft, Plus } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ORDER_TYPE_LABEL, OrderStatusBadge, formatScheduleDate, formatWindow } from '@/components/orders/labels';
import { Alert } from '@/components/ui/alert';
import { buttonVariants } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { requirePageActor } from '@/server/auth/guards';
import { listOwnOrders } from '@/server/modules/orders/orders.service';

export const metadata: Metadata = { title: 'Meus pedidos' };

export default async function MyOrdersPage() {
  const actor = await requirePageActor('portal.access', '/portal/pedidos');
  const orders = await listOwnOrders(actor).catch(() => null);
  return (
    <div className="space-y-4">
      <Link href="/portal" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Início
      </Link>
      <div className="flex items-center justify-between gap-2">
        <h1 className="text-xl font-semibold">Meus pedidos</h1>
        <Link href="/portal/pedidos/novo" className={buttonVariants({ size: 'sm' })}>
          <Plus aria-hidden /> Novo pedido
        </Link>
      </div>
      {orders === null && <Alert>Seu usuário ainda não está vinculado a um cadastro de cliente.</Alert>}
      {orders?.length === 0 && <p className="text-sm text-muted-foreground">Você ainda não fez pedidos.</p>}
      <ul className="space-y-2">
        {orders?.map((o) => (
          <li key={o.id}>
            <Link href={`/portal/pedidos/${o.id}`} className="block rounded-lg hover:ring-2 hover:ring-ring">
              <Card>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">
                      {o.number} · {ORDER_TYPE_LABEL[o.type]}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {formatScheduleDate(o.scheduledDate)} · {formatWindow(o.windowStart, o.windowEnd)}
                      {o.totalDelivery > 0 && ` · entregar ${o.totalDelivery}`}
                      {o.totalCollection > 0 && ` · coletar ${o.totalCollection}`}
                    </p>
                  </div>
                  <OrderStatusBadge status={o.status} />
                </CardContent>
              </Card>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
