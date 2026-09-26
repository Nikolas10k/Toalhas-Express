'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Alert } from '@/components/ui/alert';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Switch } from '@/components/ui/switch';
import { apiFetch, describeApiError } from '@/lib/api-client';

interface SettingsResponse {
  name: string;
  slug: string;
  settings: { customers: { selfSignupEnabled: boolean; requireApproval: boolean } };
  publicSignupUrl: string | null;
}

export function SettingsForm({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ['org-settings'], queryFn: ({ signal }) => apiFetch<SettingsResponse>('/api/admin/organization/settings', { signal }) });
  const save = useMutation({
    mutationFn: (customers: SettingsResponse['settings']['customers']) =>
      apiFetch('/api/admin/organization/settings', { method: 'PATCH', body: { customers } }),
    onSuccess: () => {
      toast.success('Configuração salva.');
      qc.invalidateQueries({ queryKey: ['org-settings'] });
    },
    onError: (e) => toast.error(describeApiError(e)),
  });

  if (q.isPending) return <Skeleton className="h-40 w-full" />;
  if (q.error) return <Alert variant="destructive">{describeApiError(q.error)}</Alert>;
  const c = q.data.settings.customers;

  return (
    <Card className="max-w-2xl">
      <CardHeader>
        <CardTitle className="text-base">Cadastro de clientes</CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <Row
          id="self-signup"
          title="Permitir auto cadastro"
          text={
            q.data.publicSignupUrl
              ? `Clientes podem se cadastrar em ${q.data.publicSignupUrl}.`
              : 'Para ativar a página pública, defina PUBLIC_SIGNUP_ORG_SLUG no servidor com o identificador desta organização.'
          }
          checked={c.selfSignupEnabled}
          disabled={!canManage || save.isPending}
          onChange={(v) => save.mutate({ ...c, selfSignupEnabled: v })}
        />
        <Row
          id="require-approval"
          title="Exigir aprovação antes de liberar pedidos"
          text="Clientes do auto cadastro ficam como “Aguardando aprovação” até alguém da equipe aprovar."
          checked={c.requireApproval}
          disabled={!canManage || save.isPending}
          onChange={(v) => save.mutate({ ...c, requireApproval: v })}
        />
        {!canManage && <p className="text-sm text-muted-foreground">Você pode ver, mas não alterar, estas configurações.</p>}
      </CardContent>
    </Card>
  );
}

function Row({ id, title, text, checked, disabled, onChange }: { id: string; title: string; text: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <label htmlFor={id} className="font-medium">
          {title}
        </label>
        <p className="text-sm text-muted-foreground">{text}</p>
      </div>
      <Switch id={id} checked={checked} onCheckedChange={onChange} disabled={disabled} />
    </div>
  );
}
