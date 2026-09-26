import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent } from '@/components/ui/card';
import { formatDateTime } from '@/lib/utils';
import { requirePageActor } from '@/server/auth/guards';
import { getOwnBalances } from '@/server/modules/inventory/inventory.service';

export const metadata: Metadata = { title: 'Minhas toalhas' };

export default async function MyTowelsPage() {
  const actor = await requirePageActor('portal.access', '/portal/toalhas');
  const balances = await getOwnBalances(actor);
  const total = balances.reduce((a, b) => a + b.quantity, 0);
  return (
    <div className="space-y-4">
      <Link href="/portal" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Início
      </Link>
      <h1 className="text-xl font-semibold">Minhas toalhas</h1>
      <Card>
        <CardContent className="pt-6">
          <p className="text-3xl font-semibold">{total}</p>
          <p className="text-sm text-muted-foreground">toalhas em sua posse</p>
        </CardContent>
      </Card>
      {balances.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nenhuma toalha registrada com você no momento.</p>
      ) : (
        <ul className="space-y-2">
          {balances.map((b) => (
            <li key={b.productId}>
              <Card>
                <CardContent className="flex items-center justify-between gap-3 p-4">
                  <div>
                    <p className="font-medium">{b.name}</p>
                    <p className="text-xs text-muted-foreground">
                      Última entrega: {b.lastDeliveryAt ? formatDateTime(b.lastDeliveryAt) : '—'} · Última coleta:{' '}
                      {b.lastCollectionAt ? formatDateTime(b.lastCollectionAt) : '—'}
                    </p>
                  </div>
                  <p className="text-2xl font-semibold tabular-nums">{b.quantity}</p>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
      <p className="text-xs text-muted-foreground">Divergência na quantidade? Fale com a Toalhas Express — nada é corrigido sem registro.</p>
    </div>
  );
}
