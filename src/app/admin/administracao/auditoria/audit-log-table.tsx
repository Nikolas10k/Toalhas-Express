'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { apiFetch, ApiError } from '@/lib/api-client';
import { formatDateTime } from '@/lib/utils';

interface AuditItem {
  id: string;
  actorType: string;
  actorId: string | null;
  actorName: string | null;
  action: string;
  entityType: string;
  entityId: string | null;
  before: unknown;
  after: unknown;
  metadata: Record<string, unknown>;
  ip: string | null;
  requestId: string | null;
  createdAt: string;
}

interface AuditPage {
  items: AuditItem[];
  nextCursor: string | null;
}

const ACTION_RE = /^[a-z_]+(\.[a-z_]+)+$/;

export function AuditLogTable() {
  const [actionInput, setActionInput] = useState('');
  const [action, setAction] = useState<string | undefined>();
  const [expanded, setExpanded] = useState<string | null>(null);

  const query = useInfiniteQuery({
    queryKey: ['audit-logs', action],
    initialPageParam: null as string | null,
    queryFn: ({ pageParam, signal }) => {
      const params = new URLSearchParams({ limit: '50' });
      if (action) params.set('action', action);
      if (pageParam) params.set('cursor', pageParam);
      return apiFetch<AuditPage>(`/api/admin/audit-logs?${params}`, { signal });
    },
    getNextPageParam: (last) => last.nextCursor,
  });

  const items = query.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-4">
      <form
        className="flex flex-wrap items-end gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          const v = actionInput.trim();
          setAction(v === '' ? undefined : ACTION_RE.test(v) ? v : undefined);
        }}
      >
        <div className="space-y-1">
          <Label htmlFor="action-filter">Ação</Label>
          <Input
            id="action-filter"
            placeholder="ex.: auth.login_succeeded"
            value={actionInput}
            onChange={(e) => setActionInput(e.target.value)}
            className="w-72"
          />
        </div>
        <Button type="submit" variant="outline">
          Filtrar
        </Button>
      </form>

      {query.error && (
        <Alert variant="destructive">
          {query.error instanceof ApiError ? query.error.message : 'Não foi possível carregar a auditoria.'}
        </Alert>
      )}

      <Card>
        <Table>
          <THead>
            <TR>
              <TH>Data/hora</TH>
              <TH>Ator</TH>
              <TH>Ação</TH>
              <TH>Entidade</TH>
              <TH>IP</TH>
              <TH>
                <span className="sr-only">Detalhes</span>
              </TH>
            </TR>
          </THead>
          <TBody>
            {query.isPending &&
              Array.from({ length: 6 }).map((_, i) => (
                <TR key={i}>
                  <TD colSpan={6}>
                    <Skeleton className="h-5 w-full" />
                  </TD>
                </TR>
              ))}
            {!query.isPending && items.length === 0 && (
              <TR>
                <TD colSpan={6} className="py-10 text-center text-muted-foreground">
                  Nenhum registro encontrado.
                </TD>
              </TR>
            )}
            {items.map((item) => (
              <AuditRow
                key={item.id}
                item={item}
                expanded={expanded === item.id}
                onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
              />
            ))}
          </TBody>
        </Table>
      </Card>

      {query.hasNextPage && (
        <div className="flex justify-center">
          <Button variant="outline" onClick={() => query.fetchNextPage()} disabled={query.isFetchingNextPage}>
            {query.isFetchingNextPage ? 'Carregando…' : 'Carregar mais'}
          </Button>
        </div>
      )}
    </div>
  );
}

function AuditRow({ item, expanded, onToggle }: { item: AuditItem; expanded: boolean; onToggle: () => void }) {
  return (
    <>
      <TR>
        <TD className="whitespace-nowrap">{formatDateTime(item.createdAt)}</TD>
        <TD>
          <Badge variant="secondary">{item.actorType}</Badge>{' '}
          <span className="text-muted-foreground">{item.actorName ?? item.actorId?.slice(0, 8) ?? '—'}</span>
        </TD>
        <TD className="font-mono text-xs">{item.action}</TD>
        <TD>
          {item.entityType}
          {item.entityId && <span className="ml-1 font-mono text-xs text-muted-foreground">{item.entityId.slice(0, 8)}</span>}
        </TD>
        <TD className="font-mono text-xs">{item.ip ?? '—'}</TD>
        <TD>
          <Button variant="ghost" size="sm" onClick={onToggle} aria-expanded={expanded}>
            {expanded ? 'Ocultar' : 'Detalhes'}
          </Button>
        </TD>
      </TR>
      {expanded && (
        <TR>
          <TD colSpan={6} className="bg-muted/30">
            <div className="grid gap-3 md:grid-cols-3">
              <JsonBlock label="Antes" value={item.before} />
              <JsonBlock label="Depois" value={item.after} />
              <JsonBlock label="Metadados" value={{ ...item.metadata, request_id: item.requestId }} />
            </div>
          </TD>
        </TR>
      )}
    </>
  );
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <p className="mb-1 text-xs font-semibold text-muted-foreground">{label}</p>
      <pre className="max-h-64 overflow-auto rounded bg-card p-2 text-xs">{value == null ? '—' : JSON.stringify(value, null, 2)}</pre>
    </div>
  );
}
