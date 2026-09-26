import { Check, ShieldAlert } from 'lucide-react';
import type { Metadata } from 'next';
import { PageHeader } from '@/components/admin/page-header';
import { Badge } from '@/components/ui/badge';
import { Card } from '@/components/ui/card';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { requirePageActor } from '@/server/auth/guards';
import { listRolesWithPermissions } from '@/server/modules/access/access.service';

export const metadata: Metadata = { title: 'Permissões' };

export default async function PermissionsPage() {
  const actor = await requirePageActor('users.read', '/admin/administracao/permissoes');
  const { roles, permissions } = await listRolesWithPermissions(actor);
  const granted = new Map(roles.map((r) => [r.id, new Set(r.permissions)]));

  return (
    <>
      <PageHeader
        title="Permissões"
        description="Perfis são conjuntos de permissões granulares. A autorização sempre verifica a permissão, nunca o nome do perfil."
      />
      <p className="mb-3 flex items-center gap-2 text-sm text-muted-foreground">
        <ShieldAlert className="size-4" aria-hidden /> Permissões marcadas exigem confirmação recente com autenticador
        (step-up).
      </p>
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Permissão</TH>
              {roles.map((r) => (
                <TH key={r.id} className="text-center">
                  {r.name}
                  {r.mfa_required && (
                    <Badge variant="default" className="ml-1">
                      MFA
                    </Badge>
                  )}
                </TH>
              ))}
            </TR>
          </THead>
          <TBody>
            {permissions.map((p) => (
              <TR key={p.code}>
                <TD>
                  <span className="font-mono text-xs">{p.code}</span>
                  {p.requires_step_up && <ShieldAlert className="ml-1 inline size-3.5 text-warning" aria-label="Exige step-up" />}
                  <span className="block text-xs text-muted-foreground">{p.description}</span>
                </TD>
                {roles.map((r) => (
                  <TD key={r.id} className="text-center">
                    {granted.get(r.id)?.has(p.code) ? (
                      <Check className="inline size-4 text-success" aria-label="Concedida" />
                    ) : (
                      <span className="text-muted-foreground" aria-label="Não concedida">
                        –
                      </span>
                    )}
                  </TD>
                ))}
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>
    </>
  );
}
