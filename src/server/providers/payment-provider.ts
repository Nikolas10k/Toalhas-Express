import type { Cents } from '@/server/core/money';

/**
 * Contrato do gateway de pagamento (implementação Asaas na Fase 10). O domínio
 * só conhece estes tipos; status do provider nunca vaza para o domínio.
 */
export type ProviderChargeMethod = 'BOLETO' | 'PIX' | 'CREDIT_CARD';

export interface ProviderCustomerInput {
  internalCustomerId: string;
  name: string;
  document: string; // CPF/CNPJ normalizado
  email?: string;
  phone?: string;
}

export interface CreateProviderChargeInput {
  /** ID interno da charge — enviado como externalReference. */
  internalChargeId: string;
  providerCustomerId: string;
  amount: Cents;
  dueDate: string; // YYYY-MM-DD
  method: ProviderChargeMethod;
  description: string;
  interestPercentMonthly?: number;
  finePercent?: number;
  /** Chave de idempotência enviada ao provider quando suportado. */
  idempotencyKey: string;
}

export interface ProviderCharge {
  providerChargeId: string;
  status: 'PENDING' | 'OVERDUE' | 'PAID' | 'PARTIALLY_PAID' | 'CANCELLED' | 'REFUNDED' | 'FAILED';
  invoiceUrl?: string;
  bankSlipUrl?: string;
  digitableLine?: string;
  pixCopyPaste?: string;
  pixQrCodeBase64?: string;
}

export interface PaymentProvider {
  readonly name: string;
  ensureCustomer(input: ProviderCustomerInput): Promise<{ providerCustomerId: string }>;
  createCharge(input: CreateProviderChargeInput): Promise<ProviderCharge>;
  /** Consulta server-to-server (reconciliação / timeout). */
  getChargeByExternalReference(internalChargeId: string): Promise<ProviderCharge | null>;
  cancelCharge(providerChargeId: string): Promise<void>;
  refundCharge(providerChargeId: string, amount?: Cents): Promise<void>;
}
