'use client';

import { X } from 'lucide-react';
import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';

/** Diálogo modal com <dialog> nativo (foco preso, Esc fecha, acessível). */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  className,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      aria-labelledby="dialog-title"
      className={cn(
        'm-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50',
        className,
      )}
    >
      {open && (
        <div className="p-6">
          <div className="mb-4 flex items-start justify-between gap-4">
            <div>
              <h2 id="dialog-title" className="text-lg font-semibold">
                {title}
              </h2>
              {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
            </div>
            <button type="button" onClick={onClose} className="rounded p-1 hover:bg-accent" aria-label="Fechar">
              <X className="size-4" />
            </button>
          </div>
          {children}
        </div>
      )}
    </dialog>
  );
}
