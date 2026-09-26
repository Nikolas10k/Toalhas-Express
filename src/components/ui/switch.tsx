'use client';

import { cn } from '@/lib/utils';

export function Switch({
  checked,
  onCheckedChange,
  disabled,
  id,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onCheckedChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
  'aria-label'?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      id={id}
      aria-checked={checked}
      aria-label={ariaLabel}
      disabled={disabled}
      onClick={() => onCheckedChange(!checked)}
      className={cn(
        'relative inline-flex h-6 w-11 shrink-0 items-center rounded-full border-2 border-transparent transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50',
        checked ? 'bg-primary' : 'bg-input',
      )}
    >
      <span className={cn('block size-5 rounded-full bg-white shadow transition-transform', checked ? 'translate-x-5' : 'translate-x-0')} />
      <span className="sr-only">{checked ? 'Ligado' : 'Desligado'}</span>
    </button>
  );
}
