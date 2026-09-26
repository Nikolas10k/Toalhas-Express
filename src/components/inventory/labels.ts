export const STATE_LABEL: Record<string, string> = {
  EXTERNAL: 'Fora do sistema',
  AVAILABLE: 'Disponível',
  RESERVED: 'Reservado',
  IN_ROUTE: 'Em rota',
  WITH_CUSTOMER: 'Com clientes',
  AWAITING_LAUNDRY: 'Aguardando lavagem',
  IN_LAUNDRY: 'Em lavagem',
  IN_INSPECTION: 'Em inspeção',
  DAMAGED: 'Danificado',
  LOST: 'Perdido',
  DISCARDED: 'Descartado',
};

export const STATE_ORDER = [
  'AVAILABLE', 'RESERVED', 'IN_ROUTE', 'WITH_CUSTOMER', 'AWAITING_LAUNDRY', 'IN_LAUNDRY', 'IN_INSPECTION', 'DAMAGED', 'LOST', 'DISCARDED',
] as const;

export const MOVEMENT_LABEL: Record<string, string> = {
  STOCK_ENTRY: 'Entrada de estoque',
  RESERVATION: 'Reserva',
  RESERVATION_RELEASE: 'Liberação de reserva',
  DELIVERY_DISPATCH: 'Saída para rota',
  DELIVERY: 'Entrega',
  COLLECTION: 'Coleta',
  LAUNDRY_ENTRY: 'Entrada na lavanderia',
  LAUNDRY_EXIT: 'Saída da lavanderia',
  TRANSFER: 'Transferência',
  DAMAGE: 'Dano',
  LOSS: 'Perda',
  DISCARD: 'Descarte',
  MANUAL_ADJUSTMENT: 'Ajuste manual',
};

/** Transições oferecidas na tela de operação manual (espelho das regras do servidor). */
export const MANUAL_MOVES: Record<'TRANSFER' | 'DAMAGE' | 'LOSS' | 'DISCARD', [string, string][]> = {
  TRANSFER: [
    ['IN_INSPECTION', 'AVAILABLE'], ['IN_ROUTE', 'AVAILABLE'], ['IN_ROUTE', 'AWAITING_LAUNDRY'], ['DAMAGED', 'AWAITING_LAUNDRY'],
    ['DAMAGED', 'AVAILABLE'], ['LOST', 'AVAILABLE'], ['AVAILABLE', 'AWAITING_LAUNDRY'],
  ],
  DAMAGE: ['AVAILABLE', 'RESERVED', 'IN_ROUTE', 'WITH_CUSTOMER', 'AWAITING_LAUNDRY', 'IN_LAUNDRY', 'IN_INSPECTION'].map((s) => [s, 'DAMAGED']),
  LOSS: ['AVAILABLE', 'RESERVED', 'IN_ROUTE', 'WITH_CUSTOMER', 'AWAITING_LAUNDRY', 'IN_LAUNDRY', 'IN_INSPECTION'].map((s) => [s, 'LOST']),
  DISCARD: [['DAMAGED', 'DISCARDED'], ['IN_INSPECTION', 'DISCARDED'], ['AVAILABLE', 'DISCARDED'], ['LOST', 'DISCARDED']],
};
