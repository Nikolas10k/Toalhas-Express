import * as React from 'react';
import { cn } from '@/lib/utils';

/** Select nativo (acessível e funcional no mobile), com o visual do design system. */
export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        'flex h-10 w-full rounded-md border border-input bg-card px-3 py-2 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50 aria-[invalid=true]:border-destructive',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  );
}
