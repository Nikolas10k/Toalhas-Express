'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import type { NavSection } from './nav-config';

export function AdminSidebar({ sections }: { sections: NavSection[] }) {
  const pathname = usePathname();
  return (
    <nav aria-label="Menu principal" className="space-y-5 text-sm">
      {sections.map((section, idx) => (
        <div key={section.label || idx}>
          {section.label && (
            <p className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              {section.label}
            </p>
          )}
          <ul className="space-y-0.5">
            {section.items.map((item) => {
              const active = pathname === item.href;
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    aria-current={active ? 'page' : undefined}
                    className={cn(
                      'flex items-center justify-between gap-2 rounded-md px-3 py-2.5 transition-colors hover:bg-accent lg:py-1.5',
                      active && 'bg-accent font-medium text-accent-foreground',
                    )}
                  >
                    <span>{item.label}</span>
                    {item.planned && <span className="text-xs text-muted-foreground">em breve</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}
