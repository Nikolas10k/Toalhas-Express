'use client';

import { cn } from '@/lib/utils';

export interface TabItem {
  id: string;
  label: string;
}

/** Abas acessíveis (role=tablist). O conteúdo é renderizado pelo chamador. */
export function Tabs({ items, value, onChange }: { items: TabItem[]; value: string; onChange: (id: string) => void }) {
  return (
    <div role="tablist" aria-orientation="horizontal" className="flex gap-1 overflow-x-auto border-b">
      {items.map((t) => (
        <button
          key={t.id}
          role="tab"
          type="button"
          id={`tab-${t.id}`}
          aria-selected={value === t.id}
          aria-controls={`panel-${t.id}`}
          onClick={() => onChange(t.id)}
          className={cn(
            '-mb-px whitespace-nowrap border-b-2 px-3 py-2 text-sm transition-colors',
            value === t.id ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground',
          )}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
