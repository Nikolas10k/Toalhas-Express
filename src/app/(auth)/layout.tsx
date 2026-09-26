export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-muted/40 px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <p className="text-2xl font-bold tracking-tight text-primary">Toalhas Express</p>
          <p className="text-sm text-muted-foreground">Gestão de aluguel de toalhas</p>
        </div>
        {children}
      </div>
    </main>
  );
}
