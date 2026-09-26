export interface PlannableOrder {
  id: string;
  number: string;
  customerId: string;
  customerName: string | null;
  type: string;
  address: Record<string, string | null>;
  latitude: number | null;
  longitude: number | null;
  windowStart: string | null;
  windowEnd: string | null;
  totalDelivery: number;
  totalCollection: number;
}

export interface DriverOption {
  id: string;
  fullName: string;
  status: string;
  defaultVehicleId: string | null;
  userId: string | null;
}

export interface VehicleOption {
  id: string;
  plate: string;
  model: string;
  capacity: number;
  status: string;
}

export function shortAddress(a: Record<string, string | null>): string {
  return [[a.street, a.number].filter(Boolean).join(', '), a.district, a.city].filter(Boolean).join(' · ') || 'Sem endereço';
}
