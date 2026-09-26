'use client';

import { useMutation, useQuery } from '@tanstack/react-query';
import { ArrowLeft, CheckCircle2, Download, FileUp } from 'lucide-react';
import Link from 'next/link';
import { useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ApiError, apiFetch, describeApiError } from '@/lib/api-client';
import { cn } from '@/lib/utils';

const FIELDS: { id: string; label: string; required?: boolean }[] = [
  { id: 'document', label: 'CPF/CNPJ', required: true },
  { id: 'legalName', label: 'Nome / Razão social', required: true },
  { id: 'tradeName', label: 'Nome fantasia' },
  { id: 'personType', label: 'Tipo (PF/PJ)' },
  { id: 'contactName', label: 'Responsável' },
  { id: 'phone', label: 'Telefone' },
  { id: 'whatsapp', label: 'WhatsApp' },
  { id: 'email', label: 'E-mail' },
  { id: 'postalCode', label: 'CEP' },
  { id: 'street', label: 'Logradouro' },
  { id: 'number', label: 'Número' },
  { id: 'complement', label: 'Complemento' },
  { id: 'district', label: 'Bairro' },
  { id: 'city', label: 'Cidade' },
  { id: 'state', label: 'UF' },
  { id: 'notes', label: 'Observações' },
];

const STRATEGIES = [
  { id: 'ONLY_NEW', label: 'Só novos', text: 'Cadastra os novos e ignora quem já existe (mesmo CPF/CNPJ).' },
  { id: 'UPDATE_DUPLICATES', label: 'Novos e atualizar existentes', text: 'Cadastra os novos e atualiza os existentes com os dados preenchidos da planilha.' },
  { id: 'ONLY_UPDATE', label: 'Só atualizar existentes', text: 'Atualiza quem já existe e ignora os novos.' },
] as const;

interface Upload {
  importId: string;
  headers: string[];
  rowCount: number;
  preview: Record<string, string>[];
  suggestedMapping: Record<string, string>;
}
interface Summary {
  total: number;
  insert: number;
  update: number;
  skip: number;
  reject: number;
  imported?: number;
  updated?: number;
  skipped?: number;
  rejected?: number;
}
interface RowItem {
  rowNumber: number;
  raw: Record<string, string>;
  errors: { field: string; message: string }[];
  action: string | null;
  result: string | null;
}

const STEPS = ['Arquivo', 'Colunas', 'Revisão', 'Resultado'];

export function ImportWizard() {
  const [step, setStep] = useState(0);
  const [upload, setUpload] = useState<Upload | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [strategy, setStrategy] = useState<(typeof STRATEGIES)[number]['id']>('ONLY_NEW');
  const [summary, setSummary] = useState<Summary | null>(null);
  const [filter, setFilter] = useState<'rejected' | 'all'>('rejected');

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const form = new FormData();
      form.append('file', file);
      const res = await fetch('/api/admin/customer-imports', { method: 'POST', body: form, credentials: 'same-origin' });
      const body = await res.json().catch(() => null);
      if (!res.ok) throw new ApiError(res.status, body?.error?.code ?? 'UNKNOWN', body?.error?.message ?? 'Falha no envio.', body?.error?.issues ?? []);
      return body.data as Upload;
    },
    onSuccess: (u) => {
      setUpload(u);
      setMapping(u.suggestedMapping);
      setStep(1);
    },
  });

  const validate = useMutation({
    mutationFn: () =>
      apiFetch<{ summary: Summary }>(`/api/admin/customer-imports/${upload!.importId}/validate`, {
        body: { mapping: Object.fromEntries(Object.entries(mapping).filter(([, v]) => v)), strategy },
      }),
    onSuccess: (r) => {
      setSummary(r.summary);
      setFilter(r.summary.reject > 0 ? 'rejected' : 'all');
      setStep(2);
    },
  });

  const commit = useMutation({
    mutationFn: () => apiFetch<{ summary: Summary }>(`/api/admin/customer-imports/${upload!.importId}/commit`, { method: 'POST' }),
    onSuccess: (r) => {
      setSummary(r.summary);
      setStep(3);
      toast.success('Importação concluída.');
    },
  });

  const rows = useQuery({
    queryKey: ['import-rows', upload?.importId, filter, step],
    enabled: Boolean(upload) && step >= 2,
    queryFn: ({ signal }) =>
      apiFetch<{ items: RowItem[]; hasMore: boolean }>(`/api/admin/customer-imports/${upload!.importId}/rows?filter=${filter}`, { signal }),
  });

  const missingRequired = FIELDS.filter((f) => f.required && !mapping[f.id]);

  return (
    <>
      <Link href="/admin/clientes" className="mb-3 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
        <ArrowLeft className="size-4" aria-hidden /> Clientes
      </Link>
      <PageHeader title="Importar clientes" description="Planilha CSV (separada por ; ou ,) com até 5.000 linhas e 2 MB." />

      <ol className="mb-6 flex flex-wrap gap-2" aria-label="Etapas">
        {STEPS.map((s, i) => (
          <li
            key={s}
            aria-current={i === step ? 'step' : undefined}
            className={cn('rounded-full border px-3 py-1 text-sm', i === step ? 'border-primary bg-primary/10 font-medium text-primary' : i < step ? 'text-foreground' : 'text-muted-foreground')}
          >
            {i + 1}. {s}
          </li>
        ))}
      </ol>

      {step === 0 && (
        <Card>
          <CardContent className="space-y-4 pt-6">
            <p className="text-sm text-muted-foreground">
              A primeira linha deve ter os nomes das colunas. Obrigatórios: CPF/CNPJ e nome/razão social. Importações nunca marcam
              consentimento de WhatsApp/e-mail — isso é registrado depois, com o cliente.
            </p>
            <Label htmlFor="csv-file" className="flex cursor-pointer flex-col items-center gap-2 rounded-lg border-2 border-dashed p-10 text-center hover:bg-accent">
              <FileUp className="size-8 text-primary" aria-hidden />
              <span className="font-medium">{uploadMutation.isPending ? 'Enviando…' : 'Escolher arquivo .csv'}</span>
            </Label>
            <input
              id="csv-file"
              type="file"
              accept=".csv,text/csv"
              className="sr-only"
              disabled={uploadMutation.isPending}
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) uploadMutation.mutate(f);
                e.target.value = '';
              }}
            />
            {uploadMutation.error && <Alert variant="destructive">{describeApiError(uploadMutation.error)}</Alert>}
          </CardContent>
        </Card>
      )}

      {step === 1 && upload && (
        <div className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Mapeamento de colunas</CardTitle>
              <p className="text-sm text-muted-foreground">{upload.rowCount} linhas encontradas. Confira qual coluna da planilha corresponde a cada campo.</p>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FIELDS.map((f) => (
                <div key={f.id} className="space-y-1.5">
                  <Label htmlFor={`map-${f.id}`}>
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </Label>
                  <Select id={`map-${f.id}`} value={mapping[f.id] ?? ''} onChange={(e) => setMapping({ ...mapping, [f.id]: e.target.value })}>
                    <option value="">— não importar —</option>
                    {upload.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Clientes que já existem</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {STRATEGIES.map((s) => (
                <label key={s.id} className={cn('flex cursor-pointer gap-3 rounded-md border p-3', strategy === s.id && 'border-primary bg-primary/5')}>
                  <input type="radio" name="strategy" value={s.id} checked={strategy === s.id} onChange={() => setStrategy(s.id)} className="mt-1" />
                  <span>
                    <span className="font-medium">{s.label}</span>
                    <span className="block text-sm text-muted-foreground">{s.text}</span>
                  </span>
                </label>
              ))}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">Prévia (10 primeiras linhas)</CardTitle>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  {upload.headers.map((h) => (
                    <TH key={h}>{h}</TH>
                  ))}
                </TR>
              </THead>
              <TBody>
                {upload.preview.map((r, i) => (
                  <TR key={i}>
                    {upload.headers.map((h) => (
                      <TD key={h} className="whitespace-nowrap">
                        {r[h]}
                      </TD>
                    ))}
                  </TR>
                ))}
              </TBody>
            </Table>
          </Card>

          {validate.error && <Alert variant="destructive">{describeApiError(validate.error)}</Alert>}
          <div className="flex justify-end">
            <Button onClick={() => validate.mutate()} disabled={missingRequired.length > 0 || validate.isPending}>
              {validate.isPending ? 'Validando…' : 'Validar planilha'}
            </Button>
          </div>
        </div>
      )}

      {step >= 2 && summary && upload && (
        <div className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-4">
            {step === 2 ? (
              <>
                <Stat label="Novos a cadastrar" value={summary.insert} />
                <Stat label="Existentes a atualizar" value={summary.update} />
                <Stat label="Ignorados" value={summary.skip} />
                <Stat label="Com erro (não serão importados)" value={summary.reject} tone={summary.reject ? 'bad' : undefined} />
              </>
            ) : (
              <>
                <Stat label="Importados" value={summary.imported ?? 0} tone="good" />
                <Stat label="Atualizados" value={summary.updated ?? 0} />
                <Stat label="Ignorados" value={summary.skipped ?? 0} />
                <Stat label="Rejeitados" value={summary.rejected ?? 0} tone={summary.rejected ? 'bad' : undefined} />
              </>
            )}
          </div>

          {step === 3 && (
            <Alert>
              <CheckCircle2 className="mr-1 inline size-4 text-success" aria-hidden /> Importação concluída. Os novos clientes entraram ativos
              e a localização no mapa será feita automaticamente.
            </Alert>
          )}

          <Card>
            <CardHeader className="flex-row items-center justify-between gap-2">
              <CardTitle className="text-base">Linhas</CardTitle>
              <div className="flex gap-2">
                <Select aria-label="Filtrar linhas" value={filter} onChange={(e) => setFilter(e.target.value as 'rejected' | 'all')} className="w-44">
                  <option value="rejected">Somente com erro</option>
                  <option value="all">Todas</option>
                </Select>
                {(summary.reject > 0 || (summary.rejected ?? 0) > 0) && (
                  <a href={`/api/admin/customer-imports/${upload.importId}/rejected`} className={buttonVariants({ variant: 'outline', size: 'sm' })}>
                    <Download aria-hidden /> Baixar rejeitados
                  </a>
                )}
              </div>
            </CardHeader>
            <Table>
              <THead>
                <TR>
                  <TH>Linha</TH>
                  <TH>Situação</TH>
                  <TH>Dados</TH>
                  <TH>Erros</TH>
                </TR>
              </THead>
              <TBody>
                {rows.data?.items.length === 0 && (
                  <TR>
                    <TD colSpan={4} className="py-8 text-center text-muted-foreground">
                      Nenhuma linha neste filtro.
                    </TD>
                  </TR>
                )}
                {rows.data?.items.map((r) => (
                  <TR key={r.rowNumber}>
                    <TD>{r.rowNumber}</TD>
                    <TD>
                      <RowBadge action={r.action} result={r.result} />
                    </TD>
                    <TD className="max-w-xs truncate text-xs text-muted-foreground">{Object.values(r.raw).filter(Boolean).join(' · ')}</TD>
                    <TD className="text-sm text-destructive">{r.errors.map((e) => e.message).join('; ')}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
            {rows.data?.hasMore && <p className="p-3 text-xs text-muted-foreground">Mostrando as 50 primeiras. Baixe o relatório para ver todas.</p>}
          </Card>

          {step === 2 && (
            <>
              {commit.error && <Alert variant="destructive">{describeApiError(commit.error)}</Alert>}
              <div className="flex flex-wrap justify-end gap-2">
                <Button variant="outline" onClick={() => setStep(1)}>
                  Voltar ao mapeamento
                </Button>
                <Button onClick={() => commit.mutate()} disabled={commit.isPending || summary.insert + summary.update === 0}>
                  {commit.isPending ? 'Importando…' : `Importar ${summary.insert + summary.update} cliente(s)`}
                </Button>
              </div>
            </>
          )}
          {step === 3 && (
            <div className="flex justify-end">
              <Link href="/admin/clientes" className={buttonVariants()}>
                Ver clientes
              </Link>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function Stat({ label, value, tone }: { label: string; value: number; tone?: 'good' | 'bad' }) {
  return (
    <Card>
      <CardContent className="pt-6">
        <p className={cn('text-3xl font-semibold', tone === 'bad' && 'text-destructive', tone === 'good' && 'text-success')}>{value}</p>
        <p className="text-sm text-muted-foreground">{label}</p>
      </CardContent>
    </Card>
  );
}

const ROW_LABEL: Record<string, { label: string; variant: 'success' | 'secondary' | 'destructive' | 'default' }> = {
  INSERT: { label: 'Novo', variant: 'default' },
  UPDATE: { label: 'Atualizar', variant: 'secondary' },
  SKIP: { label: 'Ignorar', variant: 'secondary' },
  REJECT: { label: 'Com erro', variant: 'destructive' },
  IMPORTED: { label: 'Importado', variant: 'success' },
  UPDATED: { label: 'Atualizado', variant: 'success' },
  SKIPPED: { label: 'Ignorado', variant: 'secondary' },
  REJECTED: { label: 'Rejeitado', variant: 'destructive' },
};

function RowBadge({ action, result }: { action: string | null; result: string | null }) {
  const key = result ?? action ?? '';
  const s = ROW_LABEL[key] ?? { label: key || '—', variant: 'secondary' as const };
  return <Badge variant={s.variant}>{s.label}</Badge>;
}
