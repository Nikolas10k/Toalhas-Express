'use client';

import { useMutation } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

interface Member {
  memberId: string;
  userId: string;
  fullName: string | null;
  status: string;
  roles: string[];
  createdAt: string;
}

const STATUS: Record<string, { label: string; variant: 'success' | 'warning' | 'secondary' | 'destructive' }> = {
  active: { label: 'Ativo', variant: 'success' },
  invited: { label: 'Convidado', variant: 'secondary' },
  suspended: { label: 'Suspenso', variant: 'warning' },
  removed: { label: 'Removido', variant: 'destructive' },
};

export function UsersManager({
  members,
  roles,
  currentUserId,
  can,
}: {
  members: Member[];
  roles: { code: string; name: string }[];
  currentUserId: string;
  can: { manage: boolean; roles: boolean };
}) {
  const router = useRouter();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ fullName: '', email: '', roleCodes: ['MANAGER'] as string[] });
  const [editing, setEditing] = useState<Member | null>(null);
  const [editRoles, setEditRoles] = useState<string[]>([]);
  const [statusTarget, setStatusTarget] = useState<Member | null>(null);
  const [reason, setReason] = useState('');

  const done = (msg: string) => {
    toast.success(msg);
    router.refresh();
  };
  const inviteM = useMutation({
    mutationFn: () => apiFetch('/api/admin/users', { body: invite }),
    onSuccess: () => {
      setInviteOpen(false);
      setInvite({ fullName: '', email: '', roleCodes: ['MANAGER'] });
      done('Convite enviado por e-mail.');
    },
  });
  const rolesM = useMutation({
    mutationFn: () => apiFetch(`/api/admin/users/${editing!.memberId}/roles`, { method: 'PUT', body: { roleCodes: editRoles } }),
    onSuccess: () => {
      setEditing(null);
      done('Perfis atualizados.');
    },
  });
  const statusM = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/users/${statusTarget!.memberId}/status`, {
        body: { status: statusTarget!.status === 'active' ? 'suspended' : 'active', reason },
      }),
    onSuccess: () => {
      setStatusTarget(null);
      setReason('');
      done('Status atualizado.');
    },
  });

  const toggle = (list: string[], code: string) => (list.includes(code) ? list.filter((c) => c !== code) : [...list, code]);

  return (
    <>
      {can.manage && can.roles && (
        <div className="mb-4 flex justify-end">
          <Button onClick={() => setInviteOpen(true)}>
            <UserPlus aria-hidden /> Convidar usuário
          </Button>
        </div>
      )}
      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Nome</TH>
              <TH>Perfis</TH>
              <TH>Status</TH>
              <TH>Desde</TH>
              <TH>
                <span className="sr-only">Ações</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {members.map((m) => {
              const s = STATUS[m.status] ?? { label: m.status, variant: 'secondary' as const };
              const self = m.userId === currentUserId;
              return (
                <TR key={m.memberId}>
                  <TD>
                    {m.fullName ?? <span className="text-muted-foreground">Sem nome</span>}
                    {self && <span className="ml-1 text-xs text-muted-foreground">(você)</span>}
                  </TD>
                  <TD className="space-x-1">
                    {m.roles.map((r) => (
                      <Badge key={r} variant="outline">
                        {roles.find((x) => x.code === r)?.name ?? r}
                      </Badge>
                    ))}
                  </TD>
                  <TD>
                    <Badge variant={s.variant}>{s.label}</Badge>
                  </TD>
                  <TD className="whitespace-nowrap">{formatDateTime(m.createdAt)}</TD>
                  <TD className="space-x-1 text-right whitespace-nowrap">
                    {can.roles && (
                      <Button size="sm" variant="ghost" onClick={() => { setEditing(m); setEditRoles(m.roles); }}>
                        Perfis
                      </Button>
                    )}
                    {can.manage && !self && (m.status === 'active' || m.status === 'suspended') && (
                      <Button size="sm" variant="ghost" onClick={() => setStatusTarget(m)}>
                        {m.status === 'active' ? 'Suspender' : 'Reativar'}
                      </Button>
                    )}
                  </TD>
                </TR>
              );
            })}
          </TBody>
        </Table>
      </Card>

      <Dialog open={inviteOpen} onClose={() => setInviteOpen(false)} title="Convidar usuário" description="A pessoa recebe um e-mail para definir a senha.">
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); inviteM.mutate(); }}>
          <Field id="inv-name" label="Nome" required>
            <Input id="inv-name" value={invite.fullName} onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} />
          </Field>
          <Field id="inv-email" label="E-mail" required>
            <Input id="inv-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
          </Field>
          <RolePicker roles={roles} value={invite.roleCodes} onToggle={(c) => setInvite({ ...invite, roleCodes: toggle(invite.roleCodes, c) })} />
          {inviteM.error && <Alert variant="destructive">{describeApiError(inviteM.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" disabled={inviteM.isPending || invite.roleCodes.length === 0}>
              Enviar convite
            </Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={editing !== null} onClose={() => setEditing(null)} title={`Perfis de ${editing?.fullName ?? 'usuário'}`}>
        <div className="space-y-4">
          <RolePicker roles={roles} value={editRoles} onToggle={(c) => setEditRoles(toggle(editRoles, c))} />
          {rolesM.error && <Alert variant="destructive">{describeApiError(rolesM.error)}</Alert>}
          <div className="flex justify-end">
            <Button onClick={() => rolesM.mutate()} disabled={rolesM.isPending || editRoles.length === 0}>
              Salvar perfis
            </Button>
          </div>
        </div>
      </Dialog>

      <Dialog
        open={statusTarget !== null}
        onClose={() => setStatusTarget(null)}
        title={statusTarget?.status === 'active' ? `Suspender ${statusTarget?.fullName ?? 'usuário'}?` : `Reativar ${statusTarget?.fullName ?? 'usuário'}?`}
        description={statusTarget?.status === 'active' ? 'O acesso é bloqueado na próxima ação do usuário.' : 'O usuário volta a acessar com os perfis atuais.'}
      >
        <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); statusM.mutate(); }}>
          <Field id="st-reason" label="Motivo" required>
            <Input id="st-reason" value={reason} onChange={(e) => setReason(e.target.value)} />
          </Field>
          {statusM.error && <Alert variant="destructive">{describeApiError(statusM.error)}</Alert>}
          <div className="flex justify-end">
            <Button type="submit" disabled={statusM.isPending || reason.trim().length < 3}>
              Confirmar
            </Button>
          </div>
        </form>
      </Dialog>
    </>
  );
}

function RolePicker({ roles, value, onToggle }: { roles: { code: string; name: string }[]; value: string[]; onToggle: (c: string) => void }) {
  return (
    <fieldset>
      <legend className="mb-2 text-sm font-medium">Perfis</legend>
      <div className="grid gap-2 sm:grid-cols-2">
        {roles.map((r) => (
          <label key={r.code} className="flex items-center gap-2 text-sm">
            <input type="checkbox" className="size-4" checked={value.includes(r.code)} onChange={() => onToggle(r.code)} />
            {r.name}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
