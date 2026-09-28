'use client';

import { ImageIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { apiFetch, describeApiError } from '@/lib/api-client';

/** Busca um link assinado (5 min) só quando a pessoa pede para ver a foto. */
export function AttachmentLinks({ ids }: { ids: string[] }) {
  const [busy, setBusy] = useState<string | null>(null);
  if (ids.length === 0) return null;
  return (
    <span className="inline-flex flex-wrap gap-1">
      {ids.map((id, i) => (
        <Button
          key={id}
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy === id}
          onClick={async () => {
            setBusy(id);
            try {
              const { url } = await apiFetch<{ url: string }>(`/api/admin/attachments/${id}`);
              window.open(url, '_blank', 'noopener,noreferrer');
            } catch (e) {
              toast.error(describeApiError(e));
            } finally {
              setBusy(null);
            }
          }}
        >
          <ImageIcon aria-hidden /> Foto {i + 1}
        </Button>
      ))}
    </span>
  );
}
