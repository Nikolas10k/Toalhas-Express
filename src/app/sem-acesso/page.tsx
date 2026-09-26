import type { Metadata } from 'next';
import { LogoutButton } from '@/components/logout-button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export const metadata: Metadata = { title: 'Sem acesso' };

export default function NoAccessPage() {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Acesso não liberado</CardTitle>
          <CardDescription>
            Sua conta não tem permissão para esta área ou ainda não foi vinculada a uma organização. Fale com o
            administrador.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <LogoutButton />
        </CardContent>
      </Card>
    </main>
  );
}
