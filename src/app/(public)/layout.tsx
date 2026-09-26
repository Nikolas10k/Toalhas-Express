import { Logo } from '@/components/logo';

export default function PublicLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen bg-muted/40 px-4 py-10">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-6 flex flex-col items-center text-center">
          <Logo size={96} priority />
        </div>
        {children}
      </div>
    </main>
  );
}
