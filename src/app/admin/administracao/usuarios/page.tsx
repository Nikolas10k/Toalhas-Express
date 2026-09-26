import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatDateTime } from '@/lib/utils';
import { requirePageActor } from '@/server/auth/guards';
import { listMembers } from '@/server/modules/access/access.service';

export const metadata: Metadata = { title: 'Usuários' };

const STATUS_LABEL: Record<string, { label: string; variant: 'success' | 'secondary' | 'warning' | 'destructive' }> = {
  active: { label: 'Ativo', variant: 'success' },
  invited: { label: 'Convidado', variant: 'secondary' },
  suspended: { label: 'Suspenso', variant: 'warning' },
  removed: { label: 'Removido', variant: 'destructive' },
};

export default async function UsersPage() {
  const actor = await requirePageActor('users.read', '/admin/administracao/usuarios');
  const members = await listMembers(actor);
  return (
    <>
      <PageHeader title="Usuários" description="Membros da organização e seus perfis de acesso." />
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Nome</TH>
              <TH>Perfis</TH>
              <TH>Status</TH>
              <TH>MFA obrigatório</TH>
              <TH>Desde</TH>
            </TR>
          </THead>
          <TBody>
            {members.length === 0 && (
              <TR>
                <TD colSpan={5} className="py-10 text-center text-muted-foreground">
                  Nenhum usuário.
                </TD>
              </TR>
            )}
            {members.map((m) => {
              const status = STATUS_LABEL[m.status] ?? { label: m.status, variant: 'secondary' as const };
              return (
                <TR key={m.member_id}>
                  <TD>{m.full_name ?? <span className="text-muted-foreground">Sem nome</span>}</TD>
                  <TD className="space-x-1">
                    {m.roles.map((r) => (
                      <Badge key={r} variant="outline">
                        {r}
                      </Badge>
                    ))}
                  </TD>
                  <TD>
                    <Badge variant={status.variant}>{status.label}</Badge>
                  </TD>
                  <TD>{m.mfa_required ? 'Sim' : 'Conforme perfil'}</TD>
                  <TD className="whitespace-nowrap">{formatDateTime(m.created_at)}</TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
