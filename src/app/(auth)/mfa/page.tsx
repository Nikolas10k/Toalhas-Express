import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { getSessionClaims } from '@/server/auth/session';
import { sanitizeNextPath } from '@/server/http/security';
import { getMfaStatus } from '@/server/modules/auth/auth.service';
import { MfaEnroll } from './mfa-enroll';
import { MfaVerifyForm } from './mfa-verify-form';

export const metadata: Metadata = { title: 'Verificação em duas etapas' };

export default async function MfaPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const next = sanitizeNextPath(params.next, '/');
  if (!(await getSessionClaims())) redirect(`/login?next=${encodeURIComponent(next)}`);
  const status = await getMfaStatus();
  const stepUp = params.motivo === 'confirmacao';

  return (
    <Card>
      <CardHeader>
        <CardTitle>{status.enrolled ? 'Verificação em duas etapas' : 'Configure o autenticador'}</CardTitle>
        <CardDescription>
          {status.enrolled
            ? stepUp
              ? 'Esta ação é sensível. Confirme com o código do seu aplicativo autenticador.'
              : 'Digite o código de 6 dígitos do seu aplicativo autenticador.'
            : 'Sua conta exige verificação em duas etapas. Use Google Authenticator, Microsoft Authenticator, 1Password ou similar.'}
        </CardDescription>
      </CardHeader>
      <CardContent>{status.enrolled ? <MfaVerifyForm next={next} /> : <MfaEnroll next={next} />}</CardContent>
    </Card>
  );
}
