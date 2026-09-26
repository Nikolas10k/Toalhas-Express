'use client';

import { useMutation } from '@tanstack/react-query';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { apiFetch, ApiError } from '@/lib/api-client';
import { MfaVerifyForm } from './mfa-verify-form';

interface EnrollResponse {
  factorId: string;
  qrCode: string;
  secret: string;
}

export function MfaEnroll({ next }: { next: string }) {
  const enroll = useMutation({ mutationFn: () => apiFetch<EnrollResponse>('/api/auth/mfa/enroll', { method: 'POST' }) });

  if (!enroll.data) {
    return (
      <div className="space-y-4">
        {enroll.error && (
          <Alert variant="destructive">
            {enroll.error instanceof ApiError ? enroll.error.message : 'Não foi possível iniciar a configuração.'}
          </Alert>
        )}
        <Button className="w-full" onClick={() => enroll.mutate()} disabled={enroll.isPending}>
          {enroll.isPending ? 'Gerando QR Code…' : 'Configurar autenticador'}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <ol className="list-decimal space-y-1 pl-5 text-sm text-muted-foreground">
        <li>Abra o aplicativo autenticador e escaneie o QR Code.</li>
        <li>Digite abaixo o código de 6 dígitos exibido.</li>
      </ol>
      <div className="flex justify-center rounded-md border bg-white p-4">
        {/* eslint-disable-next-line @next/next/no-img-element -- data URI SVG gerado pelo Supabase */}
        <img src={enroll.data.qrCode} alt="QR Code para configurar o autenticador" width={200} height={200} />
      </div>
      <details className="text-sm">
        <summary className="cursor-pointer text-primary">Não consegue escanear? Digite a chave manualmente</summary>
        <code className="mt-2 block break-all rounded bg-muted p-2 font-mono text-xs">{enroll.data.secret}</code>
      </details>
      <MfaVerifyForm next={next} factorId={enroll.data.factorId} />
    </div>
  );
}
