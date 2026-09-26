export interface CustomerDetail {
  id: string;
  personType: 'PF' | 'PJ';
  legalName: string;
  tradeName: string | null;
  document: string | null;
  contactName: string | null;
  phone: string | null;
  whatsapp: string | null;
  email: string | null;
  postalCode: string | null;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  latitude: number | null;
  longitude: number | null;
  placeId: string | null;
  formattedAddress: string | null;
  geocodeStatus: string;
  geocodedAt: string | null;
  preferredChannel: 'WHATSAPP' | 'EMAIL' | 'PHONE' | 'NONE';
  whatsappOptIn: boolean;
  emailOptIn: boolean;
  consentUpdatedAt: string | null;
  consentSource: string | null;
  notes: string | null;
  status: 'pending' | 'active' | 'suspended' | 'inactive';
  statusReason: string | null;
  statusChangedAt: string | null;
  source: string;
  createdAt: string;
  anonymizedAt: string | null;
}

export interface Customer360Data {
  customer: CustomerDetail;
  portalUsers: { userId: string; name: string | null; since: string }[];
}

export interface Permissions {
  update: boolean;
  approve: boolean;
  audit: boolean;
  invite: boolean;
  exportData: boolean;
  anonymize: boolean;
}
