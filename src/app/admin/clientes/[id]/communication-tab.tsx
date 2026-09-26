import { CHANNEL_LABEL } from '@/components/customers/labels';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatPhone } from '@/lib/br/phone';
import { formatDateTime } from '@/lib/utils';
import type { CustomerDetail } from './types';

const CONSENT_SOURCE: Record<string, string> = {
  ADMIN: 'registrado pela equipe',
  SELF_SIGNUP: 'no auto cadastro',
  PORTAL: 'pelo cliente no portal',
  IMPORT: 'na importação',
  INTEGRATION: 'por integração',
};

export function CommunicationTab({ customer: c }: { customer: CustomerDetail }) {
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Preferências e consentimento</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <p>Canal preferido: <strong>{CHANNEL_LABEL[c.preferredChannel]}</strong></p>
          <p>
            WhatsApp ({formatPhone(c.whatsapp) || 'sem número'}):{' '}
            <strong>{c.whatsappOptIn ? 'autorizado' : 'não autorizado'}</strong>
          </p>
          <p>
            E-mail ({c.email ?? 'sem e-mail'}): <strong>{c.emailOptIn ? 'autorizado' : 'não autorizado'}</strong>
          </p>
          <p className="text-muted-foreground">
            {c.consentUpdatedAt
              ? `Última alteração de consentimento em ${formatDateTime(c.consentUpdatedAt)} (${CONSENT_SOURCE[c.consentSource ?? ''] ?? c.consentSource}).`
              : 'Nenhum consentimento registrado.'}
          </p>
        </CardContent>
      </Card>
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Mensagens enviadas</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-muted-foreground">
          O histórico de notificações (WhatsApp e e-mail) estará disponível a partir da Fase 11.
        </CardContent>
      </Card>
    </div>
  );
}
