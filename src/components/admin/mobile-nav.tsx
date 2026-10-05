'use client';

import { Menu, X } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { Logo } from '@/components/logo';
import { Button } from '@/components/ui/button';
import type { NavSection } from './nav-config';
import { AdminSidebar } from './sidebar';

/** Menu do admin em telas pequenas: botão que abre o menu lateral como gaveta. */
export function AdminMobileNav({ sections }: { sections: NavSection[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (open && !el.open) el.showModal();
    if (!open && el.open) el.close();
  }, [open]);

  return (
    <>
      <Button variant="ghost" size="sm" aria-label="Abrir menu" aria-expanded={open} onClick={() => setOpen(true)}>
        <Menu aria-hidden className="size-5" />
      </Button>
      <dialog
        ref={ref}
        onClose={() => setOpen(false)}
        onClick={(e) => {
          if (e.target === e.currentTarget) setOpen(false);
        }}
        aria-label="Menu principal"
        className="m-0 h-dvh max-h-dvh w-72 max-w-[85vw] border-r bg-card p-0 text-card-foreground shadow-xl backdrop:bg-black/50"
      >
        <div className="flex h-full flex-col">
          <div className="flex h-14 shrink-0 items-center justify-between border-b px-4">
            <div className="flex items-center gap-2">
              <Logo size={32} />
              <p className="font-semibold">Toalhas Express</p>
            </div>
            <Button variant="ghost" size="sm" aria-label="Fechar menu" onClick={() => setOpen(false)}>
              <X aria-hidden className="size-5" />
            </Button>
          </div>
          {/* Fecha ao escolher um item do menu. */}
          <div
            className="flex-1 overflow-y-auto px-3 py-4"
            onClick={(e) => {
              if ((e.target as HTMLElement).closest('a')) setOpen(false);
            }}
          >
            <AdminSidebar sections={sections} />
          </div>
        </div>
      </dialog>
    </>
  );
}
