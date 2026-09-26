import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-3 px-4 text-center">
      <p className="text-4xl font-bold text-primary">404</p>
      <p className="text-muted-foreground">Página não encontrada.</p>
      <Link href="/" className="text-sm text-primary hover:underline">
        Ir para o início
      </Link>
    </main>
  );
}
