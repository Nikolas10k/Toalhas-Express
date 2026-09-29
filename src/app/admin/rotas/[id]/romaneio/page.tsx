import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { formatScheduleDate, formatWindow, ORDER_TYPE_LABEL } from '@/components/orders/labels';
import { shortAddress } from '@/components/routes/types';
import { formatPlate } from '@/lib/br/plate';
import { requirePageActor } from '@/server/auth/guards';
import { getRouteDetail } from '@/server/modules/routes/routes.service';
import { PrintButton } from './print-button';

export const metadata: Metadata = { title: 'Romaneio' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Lista de separação da rota: o que pôr na van, por parada, com espaço para conferir. */
export default async function RomaneioPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const actor = await requirePageActor('route.read', `/admin/rotas/${id}/romaneio`);
  const d = await getRouteDetail(actor, id).catch(() => null);
  if (!d) notFound();
  const stops = d.stops.filter((s) => !['SKIPPED', 'RESCHEDULED'].includes(s.status));

  // Totais para separar: toalhas de aluguel (do estoque) e enxoval pronto (por cliente).
  const rental = new Map<string, { name: string; q: number }>();
  for (const s of stops) {
    for (const i of s.items) {
      if (i.kind !== 'RENTAL' || i.deliveryQuantity === 0) continue;
      const cur = rental.get(i.productId) ?? { name: i.name, q: 0 };
      cur.q += i.deliveryQuantity;
      rental.set(i.productId, cur);
    }
  }
  const linenStops = stops.filter((s) => s.items.some((i) => i.kind === 'LINEN' && i.deliveryQuantity > 0));

  return (
    <div className="mx-auto max-w-3xl space-y-5 print:max-w-none print:text-[12px]">
      <div className="flex items-center justify-between gap-2 print:hidden">
        <Link href={`/admin/rotas/${id}`} className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
          <ArrowLeft className="size-4" aria-hidden /> Rota
        </Link>
        <PrintButton />
      </div>

      <header>
        <h1 className="text-2xl font-semibold">Romaneio · rota de {formatScheduleDate(d.route.date)}</h1>
        <p className="text-sm text-muted-foreground">
          {d.route.driverName} · {formatPlate(d.route.vehiclePlate)} {d.route.vehicleModel} · {stops.length} parada(s)
        </p>
      </header>

      <section>
        <h2 className="mb-2 font-semibold">Separar do estoque (toalhas de aluguel)</h2>
        {rental.size === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma entrega de toalha nesta rota.</p>
        ) : (
          <table className="w-full border-collapse text-sm">
            <tbody>
              {[...rental.values()].map((r) => (
                <tr key={r.name} className="border-b">
                  <td className="py-1.5">{r.name}</td>
                  <td className="py-1.5 text-right text-lg font-semibold tabular-nums">{r.q}</td>
                  <td className="w-24 py-1.5 text-right text-muted-foreground">☐ separado</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {linenStops.length > 0 && (
        <section>
          <h2 className="mb-2 font-semibold">Enxoval pronto de clientes (não misturar)</h2>
          <table className="w-full border-collapse text-sm">
            <tbody>
              {linenStops.map((s) => (
                <tr key={s.id} className="border-b align-top">
                  <td className="py-1.5 font-medium">{s.customerName ?? 'Cliente'}</td>
                  <td className="py-1.5">
                    {s.items
                      .filter((i) => i.kind === 'LINEN' && i.deliveryQuantity > 0)
                      .map((i) => `${i.deliveryQuantity} ${i.name}`)
                      .join(', ')}
                  </td>
                  <td className="w-24 py-1.5 text-right text-muted-foreground">☐ separado</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      <section>
        <h2 className="mb-2 font-semibold">Por parada</h2>
        <ol className="space-y-2">
          {stops.map((s) => {
            const deliver = s.items.filter((i) => i.deliveryQuantity > 0);
            const collect = s.items.filter((i) => i.collectionQuantity > 0);
            return (
              <li key={s.id} className="break-inside-avoid rounded-md border p-3">
                <p className="font-medium">
                  {s.sequence}. {s.customerName ?? 'Cliente'} <span className="font-normal text-muted-foreground">· {s.orderNumber} · {ORDER_TYPE_LABEL[s.orderType]}</span>
                </p>
                <p className="text-xs text-muted-foreground">
                  {shortAddress(s.address)}
                  {s.windowStart && ` · ${formatWindow(s.windowStart, s.windowEnd)}`}
                </p>
                {deliver.length > 0 && (
                  <p className="mt-1">
                    <strong>Entregar:</strong> {deliver.map((i) => `${i.deliveryQuantity} ${i.name}${i.kind === 'LINEN' ? ' (enxoval)' : ''}`).join(', ')}
                  </p>
                )}
                {collect.length > 0 && (
                  <p>
                    <strong>Coletar:</strong> {collect.map((i) => `${i.collectionQuantity} ${i.name}`).join(', ')}
                  </p>
                )}
                {s.orderType !== 'DELIVERY' && collect.length === 0 && <p>Coletar o que o cliente tiver (contar na hora).</p>}
                {s.notes && <p className="text-xs">Obs.: {s.notes}</p>}
              </li>
            );
          })}
        </ol>
      </section>
      <p className="text-xs text-muted-foreground">Conferido por: ______________________ · Saída: ____:____</p>
    </div>
  );
}
