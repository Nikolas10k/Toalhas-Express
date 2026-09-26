'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState } from 'react';
import { Toaster } from 'sonner';
import { ApiError } from '@/lib/api-client';

/**
 * Sessão sem MFA ou ação sensível sem MFA recente: leva o usuário para
 * confirmar o código e voltar à mesma tela. Nada é repetido automaticamente.
 */
function handleAuthErrors(err: unknown) {
  if (!(err instanceof ApiError) || typeof window === 'undefined') return;
  const next = encodeURIComponent(window.location.pathname + window.location.search);
  if (err.code === 'STEP_UP_REQUIRED') hardNavigate(`/mfa?motivo=confirmacao&next=${next}`);
  else if (err.code === 'MFA_REQUIRED') hardNavigate(`/mfa?next=${next}`);
  else if (err.code === 'AUTHENTICATION_REQUIRED') hardNavigate(`/login?next=${next}`);
}

/** Navegação completa (não SPA): garante que a sessão renovada seja lida do zero. */
function hardNavigate(path: string) {
  window.location.href = path;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: handleAuthErrors }),
        mutationCache: new MutationCache({ onError: handleAuthErrors }),
        defaultOptions: {
          queries: {
            staleTime: 30_000,
            refetchOnWindowFocus: false,
            retry: (count, err) => !(err instanceof ApiError && err.status >= 400 && err.status < 500) && count < 2,
          },
          // Mutações não repetem sozinhas: timeout não significa falha.
          mutations: { retry: false },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      {children}
      <Toaster richColors position="top-right" closeButton />
    </QueryClientProvider>
  );
}
