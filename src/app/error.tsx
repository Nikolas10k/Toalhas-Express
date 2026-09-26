'use client';

import { Button } from '@/components/ui/button';

export default function ErrorPage({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center">
      <h1 className="text-xl font-semibold">Algo deu errado</h1>
      <p className="max-w-md text-sm text-muted-foreground">
        Não foi possível carregar esta página. Tente novamente.
        {error.digest && <span className="mt-1 block font-mono text-xs">Referência: {error.digest}</span>}
      </p>
      <Button onClick={reset}>Tentar novamente</Button>
    </main>
  );
}
