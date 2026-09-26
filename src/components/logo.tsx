import Image from 'next/image';
import { cn } from '@/lib/utils';

/** Logo oficial (círculo). `size` em pixels. */
export function Logo({ size = 40, className, priority }: { size?: number; className?: string; priority?: boolean }) {
  return (
    <Image
      src="/logo.png"
      alt="Toalhas Express"
      width={size}
      height={size}
      priority={priority}
      className={cn('rounded-full', className)}
    />
  );
}
