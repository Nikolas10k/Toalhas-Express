'use client';

import { useEffect } from 'react';

/** Registra o service worker só no escopo do app do motorista. */
export function ServiceWorkerRegister() {
  useEffect(() => {
    if (process.env.NODE_ENV !== 'production' || !('serviceWorker' in navigator)) return;
    navigator.serviceWorker.register('/sw.js', { scope: '/motorista/' }).catch(() => {
      // Sem SW o app funciona normalmente (apenas sem a página offline).
    });
  }, []);
  return null;
}
