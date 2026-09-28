'use client';

import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { apiFetch } from '@/lib/api-client';

export interface PickedCustomer {
  id: string;
  name: string;
  status: string;
}

interface CustomerRow {
  id: string;
  legalName: string;
  tradeName: string | null;
  status: string;
  city: string | null;
}

/** Busca de cliente por nome, documento ou telefone (mesma API da lista de clientes). */
export function CustomerPicker({
  value,
  onChange,
  allowInactive = false,
}: {
  value: PickedCustomer | null;
  onChange: (c: PickedCustomer | null) => void;
  /** Ocorrências valem para qualquer cliente; pedidos só para ativos. */
  allowInactive?: boolean;
}) {
  const [term, setTerm] = useState('');
  const search = term.trim();
  const q = useQuery({
    queryKey: ['customer-picker', search],
    enabled: search.length >= 2,
    queryFn: ({ signal }) =>
      apiFetch<{ items: CustomerRow[] }>(`/api/admin/customers?${new URLSearchParams({ search, limit: '8' })}`, { signal }),
  });

  if (value) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md border p-2">
        <span className="font-medium">{value.name}</span>
        <Button type="button" variant="ghost" size="sm" onClick={() => onChange(null)}>
          Trocar
        </Button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <Input
        id="customer-search"
        type="search"
        placeholder="Digite nome, CPF/CNPJ ou telefone"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        autoComplete="off"
      />
      {search.length >= 2 && (
        <ul className="max-h-64 overflow-y-auto rounded-md border" aria-label="Resultados da busca de clientes">
          {q.isPending && <li className="p-2 text-sm text-muted-foreground">Buscando…</li>}
          {q.data?.items.length === 0 && <li className="p-2 text-sm text-muted-foreground">Nenhum cliente encontrado.</li>}
          {q.data?.items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-2 p-2 text-left text-sm hover:bg-accent disabled:opacity-50"
                disabled={!allowInactive && c.status !== 'active'}
                onClick={() => onChange({ id: c.id, name: c.tradeName ?? c.legalName, status: c.status })}
              >
                <span>
                  {c.tradeName ?? c.legalName}
                  {c.city && <span className="text-muted-foreground"> · {c.city}</span>}
                </span>
                {!allowInactive && c.status !== 'active' && <span className="text-xs text-muted-foreground">{c.status === 'pending' ? 'aguardando aprovação' : 'inativo/suspenso'}</span>}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
