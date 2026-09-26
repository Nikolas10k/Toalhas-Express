import { Logo } from '@/components/logo';

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={112} priority />
          <p className="mt-3 text-sm text-muted-foreground">Gestão de aluguel de toalhas</p>
        </div>
        {children}
      </div>
    </main>
  );
}
