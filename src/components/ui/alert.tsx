import * as React from 'react';
import { cn } from '@/lib/utils';

export function Alert({
  className,
  variant = 'default',
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'destructive' }) {
  return (
    <div
      role={variant === 'destructive' ? 'alert' : 'status'}
      className={cn(
        'rounded-md border p-3 text-sm',
        variant === 'destructive' ? 'border-destructive/40 bg-destructive/10 text-destructive' : 'bg-muted',
        className,
      )}
      {...props}
    />
  );
}
