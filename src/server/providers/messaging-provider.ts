/**
 * Contrato de mensageria (WhatsApp Business Platform oficial via n8n — Fase 11).
 * Somente templates aprovados; nada de WhatsApp Web ou bibliotecas não oficiais.
 */
export interface SendTemplateMessageInput {
  notificationId: string;
  to: string; // E.164 (+55...)
  templateName: string;
  languageCode: string;
  variables: Record<string, string>;
  idempotencyKey: string;
}

export interface MessagingProvider {
  readonly name: string;
  sendTemplate(input: SendTemplateMessageInput): Promise<{ providerMessageId: string | null; accepted: boolean }>;
}
