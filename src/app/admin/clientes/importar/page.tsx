import type { Metadata } from 'next';
import { requirePageActor } from '@/server/auth/guards';
import { ImportWizard } from './import-wizard';

export const metadata: Metadata = { title: 'Importar clientes' };

export default async function ImportPage() {
  await requirePageActor('customer.import', '/admin/clientes/importar');
  return <ImportWizard />;
}
