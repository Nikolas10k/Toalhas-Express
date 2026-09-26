import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSignupAvailability } from '@/server/modules/customers/signup.service';
import { SignupForm } from './signup-form';

export const metadata: Metadata = { title: 'Cadastro de cliente' };

export default async function SignupPage() {
  const availability = await getSignupAvailability().catch(() => ({ enabled: false, organizationName: null }));
  return (
    <Card>
      <CardHeader>
        <CardTitle>Seja cliente</CardTitle>
        <CardDescription>
          Cadastre seu estabelecimento para pedir entregas e coletas de toalhas e acompanhar tudo pelo portal.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {availability.enabled ? (
          <SignupForm />
        ) : (
          <p className="text-sm text-muted-foreground">
            O cadastro online não está disponível no momento. Fale com a Toalhas Express pelo WhatsApp ou telefone.
          </p>
        )}
        <p className="mt-6 text-center text-sm">
          Já tem acesso?{' '}
          <Link href="/login" className="text-primary hover:underline">
            Entrar
          </Link>
        </p>
      </CardContent>
    </Card>
  );
}
