import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { requirePageActor } from '@/server/auth/guards';
import { AuditLogTable } from './audit-log-table';

export const metadata: Metadata = { title: 'Auditoria' };

export default async function AuditPage() {
  await requirePageActor('audit.read', '/admin/administracao/auditoria');
  return (
    <>
      <PageHeader
        title="Auditoria"
        description="Trilha append-only de alterações, acessos e operações sensíveis. Registros não podem ser editados nem apagados."
      />
      <AuditLogTable />
    </>
  );
}
