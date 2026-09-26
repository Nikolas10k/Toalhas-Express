'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Crosshair, MapPin, RefreshCw, UserPlus } from 'lucide-react';
import dynamic from 'next/dynamic';
import { useState } from 'react';
import { toast } from 'sonner';
import { CHANNEL_LABEL, GeocodeBadge } from '@/components/customers/labels';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Field } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { apiFetch, describeApiError } from '@/lib/api-client';
import { formatAddress } from '@/lib/br/address';
import { formatDocument } from '@/lib/br/documents';
import { formatPhone } from '@/lib/br/phone';
import { formatDateTime } from '@/lib/utils';
import type { Customer360Data, Permissions } from './types';

const LocationMap = dynamic(() => import('@/components/customers/location-map').then((m) => m.LocationMap), {
  ssr: false,
  loading: () => <Skeleton className="h-72 w-full" />,
});

const SOURCE_LABEL: Record<string, string> = {
  ADMIN: 'Cadastro pela equipe',
  SELF_SIGNUP: 'Auto cadastro',
  IMPORT: 'Importação CSV',
  INTEGRATION: 'Integração',
};

export function SummaryTab({ data, can }: { data: Customer360Data; can: Permissions }) {
  const c = data.customer;
  const qc = useQueryClient();
  const refresh = () => qc.invalidateQueries({ queryKey: ['customer', c.id] });
  const [adjusting, setAdjusting] = useState(false);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [reason, setReason] = useState('');
  const [invite, setInvite] = useState({ email: '', fullName: '' });
  const readOnly = Boolean(c.anonymizedAt);

  const saveLocation = useMutation({
    mutationFn: () =>
      apiFetch(`/api/admin/customers/${c.id}/location`, {
        body: { latitude: point!.lat, longitude: point!.lng, reason },
      }),
    onSuccess: () => {
      toast.success('Localização ajustada.');
      setAdjusting(false);
      setPoint(null);
      setReason('');
      refresh();
    },
  });
  const regeocode = useMutation({
    mutationFn: () => apiFetch(`/api/admin/customers/${c.id}/geocode`, { method: 'POST' }),
    onSuccess: () => {
      toast.success('Localização automática agendada.');
      refresh();
    },
    onError: (e) => toast.error(describeApiError(e)),
  });
  const inviteUser = useMutation({
    mutationFn: () => apiFetch(`/api/admin/customers/${c.id}/portal-invite`, { body: invite }),
    onSuccess: () => {
      toast.success('Convite enviado por e-mail.');
      setInvite({ email: '', fullName: '' });
      refresh();
    },
  });

  const address = formatAddress(c);
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Card className="xl:col-span-1">
        <CardHeader>
          <CardTitle className="text-base">Dados cadastrais</CardTitle>
        </CardHeader>
        <CardContent>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
            <Item label="Tipo" value={c.personType === 'PJ' ? 'Pessoa jurídica' : 'Pessoa física'} />
            <Item label={c.personType === 'PJ' ? 'CNPJ' : 'CPF'} value={formatDocument(c.document)} mono />
            <Item label="Responsável" value={c.contactName} />
            <Item label="Telefone" value={formatPhone(c.phone)} />
            <Item label="WhatsApp" value={formatPhone(c.whatsapp)} />
            <Item label="E-mail" value={c.email} />
            <Item label="Canal preferido" value={CHANNEL_LABEL[c.preferredChannel]} />
            <Item label="Origem" value={SOURCE_LABEL[c.source] ?? c.source} />
            <Item label="Cliente desde" value={formatDateTime(c.createdAt)} />
            {c.notes && <Item label="Observações" value={c.notes} />}
          </dl>
        </CardContent>
      </Card>

      <Card className="xl:col-span-2">
        <CardHeader className="flex-row flex-wrap items-center justify-between gap-2">
          <div>
            <CardTitle className="text-base">Endereço e localização</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">{address || 'Endereço não informado.'}</p>
          </div>
          <GeocodeBadge status={c.geocodeStatus} />
        </CardHeader>
        <CardContent className="space-y-3">
          <LocationMap
            latitude={point?.lat ?? c.latitude}
            longitude={point?.lng ?? c.longitude}
            editable={adjusting}
            onChange={(lat, lng) => setPoint({ lat, lng })}
          />
          {c.formattedAddress && c.geocodeStatus !== 'MANUAL' && (
            <p className="text-xs text-muted-foreground">Endereço encontrado: {c.formattedAddress}</p>
          )}
          {can.update && !readOnly && !adjusting && (
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => setAdjusting(true)}>
                <Crosshair aria-hidden /> Ajustar no mapa
              </Button>
              <Button variant="outline" size="sm" onClick={() => regeocode.mutate()} disabled={regeocode.isPending}>
                <RefreshCw aria-hidden /> Localizar pelo endereço
              </Button>
              {c.latitude !== null && (
                <a
                  className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                  href={`https://www.google.com/maps/search/?api=1&query=${c.latitude},${c.longitude}`}
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  <MapPin className="size-4" aria-hidden /> Abrir no Google Maps
                </a>
              )}
            </div>
          )}
          {adjusting && (
            <div className="space-y-3 rounded-md border bg-muted/40 p-3">
              <p className="text-sm">Arraste o marcador (ou clique no mapa) até a entrada correta do estabelecimento.</p>
              {point && (
                <p className="font-mono text-xs">
                  {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
                </p>
              )}
              <Field id="location-reason" label="Motivo do ajuste" required>
                <Input id="location-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ex.: entrada pela rua lateral" />
              </Field>
              {saveLocation.error && <Alert variant="destructive">{describeApiError(saveLocation.error)}</Alert>}
              <div className="flex gap-2">
                <Button size="sm" onClick={() => saveLocation.mutate()} disabled={!point || reason.trim().length < 3 || saveLocation.isPending}>
                  Salvar localização
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setAdjusting(false); setPoint(null); }}>
                  Cancelar
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="xl:col-span-3">
        <CardHeader>
          <CardTitle className="text-base">Acesso ao portal</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {data.portalUsers.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nenhum usuário do cliente tem acesso ao portal.</p>
          ) : (
            <ul className="space-y-1 text-sm">
              {data.portalUsers.map((u) => (
                <li key={u.userId}>
                  {u.name ?? 'Usuário'} <span className="text-muted-foreground">· desde {formatDateTime(u.since)}</span>
                </li>
              ))}
            </ul>
          )}
          {can.invite && !readOnly && (
            <form
              className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end"
              onSubmit={(e) => {
                e.preventDefault();
                inviteUser.mutate();
              }}
            >
              <Field id="invite-name" label="Nome">
                <Input id="invite-name" value={invite.fullName} onChange={(e) => setInvite({ ...invite, fullName: e.target.value })} />
              </Field>
              <Field id="invite-email" label="E-mail">
                <Input id="invite-email" type="email" value={invite.email} onChange={(e) => setInvite({ ...invite, email: e.target.value })} />
              </Field>
              <Button type="submit" disabled={inviteUser.isPending || !invite.email || invite.fullName.length < 2}>
                <UserPlus aria-hidden /> Convidar
              </Button>
              {inviteUser.error && (
                <Alert variant="destructive" className="sm:col-span-3">
                  {describeApiError(inviteUser.error)}
                </Alert>
              )}
            </form>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

function Item({ label, value, mono }: { label: string; value: string | null | undefined; mono?: boolean }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? 'font-mono text-xs leading-5' : undefined}>{value || '—'}</dd>
    </>
  );
}
