import { ArrowLeft } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { BILLING_TYPE_LABEL, ContractStatusBadge, RENEWAL_LABEL } from '@/components/contracts/labels';
import { formatScheduleDate } from '@/components/orders/labels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCents } from '@/lib/money-format';
import { requirePageActor } from '@/server/auth/guards';
import { getOwnContract } from '@/server/modules/contracts/contracts.service';

export const metadata: Metadata = { title: 'Meu contrato' };

export default async function MyContractPage() {
  const actor = await requirePageActor('portal.access', '/portal/contrato');
  const own = await getOwnContract(actor);
  return (
    <div className="space-y-4">
      <Link href="/portal" className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Início
      </Link>
      <h1 className="text-xl font-semibold">Meu contrato</h1>
      {!own ? (
        <p className="text-sm text-muted-foreground">Você ainda não tem contrato vigente. Fale com a Toalhas Express.</p>
      ) : (
        <>
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="flex flex-wrap items-center gap-2 text-base">
                {own.contract.number} <ContractStatusBadge status={own.contract.status} />
              </CardTitle>
            </CardHeader>
            <CardContent>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                <dt className="text-muted-foreground">Cobrança</dt>
                <dd>{BILLING_TYPE_LABEL[own.contract.billingType]}</dd>
                <dt className="text-muted-foreground">Vigência</dt>
                <dd>
                  {formatScheduleDate(own.contract.startsOn)} – {own.contract.endsOn ? formatScheduleDate(own.contract.endsOn) : 'indeterminado'}
                </dd>
                <dt className="text-muted-foreground">Renovação</dt>
                <dd>{RENEWAL_LABEL[own.contract.renewal]}</dd>
                <dt className="text-muted-foreground">Vencimento</dt>
                <dd>Todo dia {own.contract.dueDay}</dd>
                {own.contract.monthlyFeeCents > 0 && (
                  <>
                    <dt className="text-muted-foreground">Mensalidade</dt>
                    <dd>{formatCents(own.contract.monthlyFeeCents)}</dd>
                  </>
                )}
                {own.contract.perDeliveryFeeCents > 0 && (
                  <>
                    <dt className="text-muted-foreground">Por entrega</dt>
                    <dd>{formatCents(own.contract.perDeliveryFeeCents)}</dd>
                  </>
                )}
                {own.contract.discountBp > 0 && (
                  <>
                    <dt className="text-muted-foreground">Desconto</dt>
                    <dd>{(own.contract.discountBp / 100).toLocaleString('pt-BR')}%</dd>
                  </>
                )}
              </dl>
              {own.contract.customTerms && <p className="mt-3 whitespace-pre-wrap text-sm">{own.contract.customTerms}</p>}
            </CardContent>
          </Card>
          {own.items.length > 0 && (
            <ul className="space-y-2">
              {own.items.map((i) => (
                <li key={i.productId}>
                  <Card>
                    <CardContent className="space-y-1 p-4 text-sm">
                      <p className="font-medium">{i.productName}</p>
                      {i.contractedQuantity > 0 && <p>Quantidade contratada: {i.contractedQuantity}</p>}
                      {i.franchiseQuantity > 0 && <p>Franquia mensal: {i.franchiseQuantity} peças</p>}
                      {i.unitPriceCents > 0 && <p>Preço por peça: {formatCents(i.unitPriceCents)}</p>}
                      {i.excessPriceCents > 0 && <p>Peça acima da franquia: {formatCents(i.excessPriceCents)}</p>}
                      {i.lossPriceCents !== null && <p>Perda: {formatCents(i.lossPriceCents)} por peça</p>}
                      {i.damagePriceCents !== null && <p>Dano: {formatCents(i.damagePriceCents)} por peça</p>}
                    </CardContent>
                  </Card>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
