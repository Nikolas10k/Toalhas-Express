'use client';

import { useInfiniteQuery, useMutation } from '@tanstack/react-query';
import { MapPin, Plus, Search, Upload } from 'lucide-react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { PageHeader } from '@/components/admin/page-header';
import { CustomerStatusBadge, GeocodeBadge, STATUS_LABEL } from '@/components/customers/labels';
import { Alert } from '@/components/ui/alert';
import { Button, buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, ApiError } from '@/lib/api-client';
import { formatDocument } from '@/lib/br/documents';
import { formatPhone } from '@/lib/br/phone';
import { cn } from '@/lib/utils';

interface CustomerItem {
  id: string;
  legalName: string;
  tradeName: string | null;
  document: string | null;
  phone: string | null;
  whatsapp: string | null;
  city: string | null;
  state: string | null;
  status: keyof typeof STATUS_LABEL;
  geocodeStatus: string;
}

interface ListResponse {
  items: CustomerItem[];
  nextCursor: string | null;
  counts?: Record<string, number>;
}

const FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'Todos' },
  { id: 'pending', label: 'Aguardando aprovação' },
  { id: 'active', label: 'Ativos' },
  { id: 'suspended', label: 'Suspensos' },
  { id: 'inactive', label: 'Inativos' },
];

export function CustomerList({ can }: { can: { create: boolean; import: boolean; update: boolean } }) {
  const router = useRouter();
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [counts, setCounts] = useState<Record<string, number>>({});

  // Busca com debounce (evita uma requisição por tecla).
  useEffect(() => {
    const t = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(t);
  }, [searchInput]);

  const query = useInfiniteQuery({
    queryKey: ['customers', search, status],
    initialPageParam: null as string | null,
    queryFn: async ({ pageParam, signal }) => {
      const p = new URLSearchParams({ limit: '25' });
      if (search) p.set('search', search);
      if (status) p.set('status', status);
      if (pageParam) p.set('cursor', pageParam);
      const res = await apiFetch<ListResponse>(`/api/admin/customers?${p}`, { signal });
      if (res.counts && !search) setCounts(res.counts);
      return res;
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const bulkGeocode = useMutation({
    mutationFn: () => apiFetch<{ enqueued: boolean }>('/api/admin/customers/geocode-pending', { method: 'POST' }),
    onSuccess: (r) =>
      toast.success(r.enqueued ? 'Localização dos clientes pendentes agendada.' : 'Já existe uma localização em massa em andamento.'),
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Falha ao agendar.'),
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];
  const total = Object.values(counts).reduce((a, b) => a + b, 0);

  return (
    <>
      <PageHeader title="Clientes" description="Salões, barbearias, clínicas, spas e academias atendidos.">
        <div className="flex flex-wrap gap-2">
          {can.update && (
            <Button variant="outline" onClick={() => bulkGeocode.mutate()} disabled={bulkGeocode.isPending}>
              <MapPin aria-hidden /> Localizar pendentes
            </Button>
          )}
          {can.import && (
            <Link href="/admin/clientes/importar" className={buttonVariants({ variant: 'outline' })}>
              <Upload aria-hidden /> Importar CSV
            </Link>
          )}
          {can.create && (
            <Link href="/admin/clientes/novo" className={buttonVariants()}>
              <Plus aria-hidden /> Novo cliente
            </Link>
          )}
        </div>
      </PageHeader>

      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div role="tablist" aria-label="Filtrar por status" className="flex flex-wrap gap-1">
          {FILTERS.map((f) => {
            const n = f.id ? (counts[f.id] ?? 0) : total;
            return (
              <button
                key={f.id}
                role="tab"
                aria-selected={status === f.id}
                onClick={() => setStatus(f.id)}
                className={cn(
                  'rounded-full border px-3 py-1 text-sm transition-colors',
                  status === f.id ? 'border-primary bg-primary/10 font-medium text-primary' : 'hover:bg-accent',
                )}
              >
                {f.label} <span className="text-muted-foreground">({n})</span>
              </button>
            );
          })}
        </div>
        <div className="relative w-full lg:w-80">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden />
          <Input
            aria-label="Buscar clientes"
            placeholder="Nome, CPF/CNPJ, telefone ou e-mail"
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            className="pl-9"
          />
        </div>
      </div>

      {query.error && (
        <Alert variant="destructive" className="mb-4">
          {query.error instanceof ApiError ? query.error.message : 'Não foi possível carregar os clientes.'}
        </Alert>
      )}

      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Cliente</TH>
              <TH>CPF/CNPJ</TH>
              <TH>Contato</TH>
              <TH>Cidade</TH>
              <TH>Status</TH>
              <TH>Localização</TH>
            </TR>
          </THead>
          <TBody>
            {query.isPending &&
              Array.from({ length: 8 }).map((_, i) => (
                <TR key={i}>
                  <TD colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TD>
                </TR>
              ))}
            {!query.isPending && items.length === 0 && (
              <TR>
                <TD colSpan={6} className="py-12 text-center">
                  <p className="font-medium">Nenhum cliente encontrado</p>
                  <p className="text-sm text-muted-foreground">
                    {search || status ? 'Ajuste a busca ou o filtro.' : 'Cadastre o primeiro cliente ou importe uma planilha.'}
                  </p>
                </TD>
              </TR>
            )}
            {items.map((c) => (
              <TR key={c.id} className="cursor-pointer" onClick={() => router.push(`/admin/clientes/${c.id}`)}>
                <TD>
                  <Link href={`/admin/clientes/${c.id}`} className="font-medium hover:underline" onClick={(e) => e.stopPropagation()}>
                    {c.tradeName ?? c.legalName}
                  </Link>
                  {c.tradeName && <span className="block text-xs text-muted-foreground">{c.legalName}</span>}
                </TD>
                <TD className="font-mono text-xs whitespace-nowrap">{formatDocument(c.document)}</TD>
                <TD className="whitespace-nowrap">{formatPhone(c.whatsapp ?? c.phone) || '—'}</TD>
                <TD>{[c.city, c.state].filter(Boolean).join(' - ') || '—'}</TD>
                <TD>
                  <CustomerStatusBadge status={c.status} />
                </TD>
                <TD>
                  <GeocodeBadge status={c.geocodeStatus} />
                </TD>
              </TR>
            ))}
          </TBody>
        </Table>
      </Card>

      {query.hasNextPage && (
        <div className="mt-4 flex justify-center">
          <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </>
  );
}
