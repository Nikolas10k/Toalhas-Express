import type { Metadata } from 'next';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Alert } from '@/components/ui/alert';
import { sanitizeNextPath } from '@/server/http/security';
import { LoginForm } from './login-form';

export const metadata: Metadata = { title: 'Entrar' };

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next, '/');
  return (
    <Card>
      <CardHeader>
        <CardTitle>Entrar</CardTitle>
        <CardDescription>Use seu e-mail e senha cadastrados.</CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {params.erro === 'link_invalido' && (
          <Alert variant="destructive">O link é inválido ou expirou. Solicite um novo.</Alert>
        )}
        <LoginForm next={next} />
      </CardContent>
    </Card>
  );
}
