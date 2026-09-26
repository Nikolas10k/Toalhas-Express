import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Providers } from '@/components/providers';
import './globals.css';

export const metadata: Metadata = {
  title: { default: 'Toalhas Express', template: '%s · Toalhas Express' },
  description: 'Gestão de aluguel de toalhas: clientes, pedidos, estoque, rotas e cobrança.',
  robots: { index: false, follow: false },
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  // Leitura de headers torna a renderização dinâmica (necessário para o nonce da CSP).
  await headers();
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
