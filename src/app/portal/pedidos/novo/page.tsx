import type { Metadata } from 'next';
import { Alert } from '@/components/ui/alert';
import { requirePageActor } from '@/server/auth/guards';
import { getOwnCustomer } from '@/server/modules/customers/customers.service';
import { PortalNewOrder } from './portal-new-order';

export const metadata: Metadata = { title: 'Novo pedido' };

export default async function PortalNewOrderPage() {
  const actor = await requirePageActor('portal.access', '/portal/pedidos/novo');
  const customer = await getOwnCustomer(actor).catch(() => null);
  if (!customer) return <Alert>Seu usuário ainda não está vinculado a um cadastro de cliente. Fale com a Toalhas Express.</Alert>;
  if (customer.status !== 'active') {
    return (
      <Alert>
        {customer.status === 'pending'
          ? 'Seu cadastro está em análise. Assim que for aprovado, você poderá fazer pedidos.'
          : 'Seu cadastro não está ativo para novos pedidos. Fale com a Toalhas Express.'}
      </Alert>
    );
  }
  return <PortalNewOrder />;
}
