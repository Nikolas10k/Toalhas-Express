import { ChevronRight } from 'lucide-react';
import type { Metadata } from 'next';
import Link from 'next/link';
import { ADMIN_NAV } from '@/components/admin/nav-config';
import { PageHeader } from '@/components/admin/page-header';
import { requirePageActor } from '@/server/auth/guards';

export const metadata: Metadata = { title: 'Dashboard' };

/** Indicadores chegam na Fase 12; até lá, atalhos para os módulos já entregues. */
export default async function AdminDashboard() {
  const actor = await requirePageActor('admin.access', '/admin');
  const sections = ADMIN_NAV.map((s) => ({
    label: s.label || 'Geral',
    items: s.items.filter((i) => i.href !== '/admin' && !i.planned && actor.permissions.has(i.permission)),
  })).filter((s) => s.items.length > 0);

  return (
    <>
      <PageHeader title="Dashboard" description="Acesso rápido aos módulos da operação." />
      <div className="grid gap-6 md:grid-cols-2 xl:grid-cols-3">
        {sections.map((section) => (
          <section key={section.label} aria-labelledby={`atalhos-${section.label}`}>
            <h2
              id={`atalhos-${section.label}`}
              className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground"
            >
              {section.label}
            </h2>
            <ul className="divide-y rounded-lg border bg-card">
              {section.items.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className="flex items-center justify-between gap-2 px-4 py-3 text-sm font-medium transition-colors hover:bg-accent"
                  >
                    {item.label}
                    <ChevronRight aria-hidden className="size-4 text-muted-foreground" />
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </>
  );
}
