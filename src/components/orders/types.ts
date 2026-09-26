export interface OrderAddress {
  street?: string | null;
  number?: string | null;
  complement?: string | null;
  district?: string | null;
  city?: string | null;
  state?: string | null;
  postalCode?: string | null;
}

export interface OrderDetail {
  order: {
    id: string;
    number: string;
    customerId: string;
    customerName: string | null;
    type: string;
    status: string;
    scheduledDate: string;
    windowStart: string | null;
    windowEnd: string | null;
    address: OrderAddress;
    notes: string | null;
    internalNotes?: string | null;
    assignedName: string | null;
    source: string;
    recurring: boolean;
    stockOverride: boolean;
    statusReason: string | null;
    createdAt: string;
  };
  items: {
    productId: string;
    sku: string;
    name: string;
    deliveryQuantity: number;
    collectionQuantity: number;
    reservedQuantity: number;
  }[];
  history: {
    id: string;
    from: string | null;
    to: string;
    reason: string | null;
    metadata: Record<string, unknown>;
    actorType: string;
    actorName: string | null;
    at: string;
  }[];
  actions: string[];
  canOverrideStock: boolean;
}

export function formatAddress(a: OrderAddress): string {
  const line1 = [a.street, a.number].filter(Boolean).join(', ');
  const parts = [line1, a.complement, a.district, [a.city, a.state].filter(Boolean).join('/')].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'Endereço não informado';
}
