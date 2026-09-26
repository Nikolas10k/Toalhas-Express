import 'server-only';
import type { Tx } from '@/server/db/client';
import type { CustomerStatus } from './customers.domain';

export interface Customer {
  id: string;
  organizationId: string;
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
  geocodedAt: Date | null;
  preferredChannel: 'WHATSAPP' | 'EMAIL' | 'PHONE' | 'NONE';
  whatsappOptIn: boolean;
  emailOptIn: boolean;
  consentUpdatedAt: Date | null;
  consentSource: string | null;
  notes: string | null;
  status: CustomerStatus;
  statusReason: string | null;
  statusChangedAt: Date | null;
  approvedAt: Date | null;
  source: 'ADMIN' | 'SELF_SIGNUP' | 'IMPORT' | 'INTEGRATION';
  importId: string | null;
  createdAt: Date;
  updatedAt: Date;
  anonymizedAt: Date | null;
}

/** Colunas graváveis (whitelist contra mass assignment). camelCase → snake_case. */
const WRITABLE: Record<string, string> = {
  personType: 'person_type',
  legalName: 'legal_name',
  tradeName: 'trade_name',
  document: 'document',
  contactName: 'contact_name',
  phone: 'phone',
  whatsapp: 'whatsapp',
  email: 'email',
  postalCode: 'postal_code',
  street: 'street',
  number: 'number',
  complement: 'complement',
  district: 'district',
  city: 'city',
  state: 'state',
  latitude: 'latitude',
  longitude: 'longitude',
  placeId: 'place_id',
  formattedAddress: 'formatted_address',
  geocodeStatus: 'geocode_status',
  geocodedAt: 'geocoded_at',
  preferredChannel: 'preferred_channel',
  whatsappOptIn: 'whatsapp_opt_in',
  emailOptIn: 'email_opt_in',
  consentUpdatedAt: 'consent_updated_at',
  consentSource: 'consent_source',
  notes: 'notes',
  status: 'status',
  statusReason: 'status_reason',
  statusChangedAt: 'status_changed_at',
  approvedAt: 'approved_at',
  approvedBy: 'approved_by',
  source: 'source',
  importId: 'import_id',
  createdBy: 'created_by',
  anonymizedAt: 'anonymized_at',
};

export type CustomerWrite = Partial<Record<keyof typeof WRITABLE, unknown>>;

function toColumns(data: CustomerWrite): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v === undefined) continue;
    const col = WRITABLE[k];
    if (!col) throw new Error(`Campo não gravável: ${k}`);
    out[col] = v;
  }
  return out;
}

const SELECT = `
  id, organization_id, person_type, legal_name, trade_name, document, contact_name, phone, whatsapp, email,
  postal_code, street, number, complement, district, city, state,
  latitude::float8 as latitude, longitude::float8 as longitude, place_id, formatted_address,
  geocode_status, geocoded_at, preferred_channel, whatsapp_opt_in, email_opt_in, consent_updated_at, consent_source,
  notes, status, status_reason, status_changed_at, approved_at, source, import_id, created_at, updated_at, anonymized_at
`;

interface Row {
  [k: string]: unknown;
}

export function mapCustomer(r: Row): Customer {
  return {
    id: r.id as string,
    organizationId: r.organization_id as string,
    personType: r.person_type as Customer['personType'],
    legalName: r.legal_name as string,
    tradeName: (r.trade_name as string) ?? null,
    document: (r.document as string) ?? null,
    contactName: (r.contact_name as string) ?? null,
    phone: (r.phone as string) ?? null,
    whatsapp: (r.whatsapp as string) ?? null,
    email: (r.email as string) ?? null,
    postalCode: (r.postal_code as string) ?? null,
    street: (r.street as string) ?? null,
    number: (r.number as string) ?? null,
    complement: (r.complement as string) ?? null,
    district: (r.district as string) ?? null,
    city: (r.city as string) ?? null,
    state: (r.state as string) ?? null,
    latitude: (r.latitude as number) ?? null,
    longitude: (r.longitude as number) ?? null,
    placeId: (r.place_id as string) ?? null,
    formattedAddress: (r.formatted_address as string) ?? null,
    geocodeStatus: r.geocode_status as string,
    geocodedAt: (r.geocoded_at as Date) ?? null,
    preferredChannel: r.preferred_channel as Customer['preferredChannel'],
    whatsappOptIn: r.whatsapp_opt_in as boolean,
    emailOptIn: r.email_opt_in as boolean,
    consentUpdatedAt: (r.consent_updated_at as Date) ?? null,
    consentSource: (r.consent_source as string) ?? null,
    notes: (r.notes as string) ?? null,
    status: r.status as CustomerStatus,
    statusReason: (r.status_reason as string) ?? null,
    statusChangedAt: (r.status_changed_at as Date) ?? null,
    approvedAt: (r.approved_at as Date) ?? null,
    source: r.source as Customer['source'],
    importId: (r.import_id as string) ?? null,
    createdAt: r.created_at as Date,
    updatedAt: r.updated_at as Date,
    anonymizedAt: (r.anonymized_at as Date) ?? null,
  };
}

export async function insertCustomer(tx: Tx, id: string, organizationId: string, data: CustomerWrite): Promise<void> {
  const cols = { id, organization_id: organizationId, ...toColumns(data) };
  // Sem RETURNING: o ator pode ter customer.create sem customer.read.
  await tx`insert into public.customers ${tx(cols)}`;
}

export async function updateCustomer(tx: Tx, id: string, data: CustomerWrite): Promise<void> {
  const cols = toColumns(data);
  if (Object.keys(cols).length === 0) return;
  await tx`update public.customers set ${tx(cols)} where id = ${id} and organization_id = app.current_org_id()`;
}

/** Busca com lock (FOR UPDATE) para alterações concorrentes. RLS garante o tenant. */
export async function findCustomerById(tx: Tx, id: string, opts: { forUpdate?: boolean } = {}): Promise<Customer | null> {
  const rows = await tx.unsafe<Row[]>(
    `select ${SELECT} from public.customers
      where id = $1 and organization_id = app.current_org_id() and deleted_at is null
      ${opts.forUpdate ? 'for update' : ''}`,
    [id],
  );
  return rows[0] ? mapCustomer(rows[0]) : null;
}

export async function findCustomersByDocuments(tx: Tx, documents: string[]): Promise<Map<string, string>> {
  if (documents.length === 0) return new Map();
  const rows = await tx<{ id: string; document: string }[]>`
    select id, document from public.customers
     where organization_id = app.current_org_id() and document = any (${documents})
  `;
  return new Map(rows.map((r) => [r.document, r.id]));
}

export async function existsByDocument(tx: Tx, organizationId: string, document: string): Promise<boolean> {
  const rows = await tx`select 1 from public.customers where organization_id = ${organizationId} and document = ${document}`;
  return rows.length > 0;
}

export interface CustomerListFilters {
  search?: string;
  status?: CustomerStatus;
  geocodeStatus?: string;
  cursor?: { createdAt: string; id: string };
  limit: number;
}

export interface CustomerListRow extends Customer {
  cursorTs: string;
}

export async function listCustomers(tx: Tx, f: CustomerListFilters): Promise<CustomerListRow[]> {
  const term = f.search?.trim();
  const digits = term?.replace(/\D/g, '') ?? '';
  const docTerm = term?.toUpperCase().replace(/[^0-9A-Z]/g, '') ?? '';
  const like = term ? `%${term.replace(/[\\%_]/g, (c) => `\\${c}`).toLowerCase()}%` : null;
  const rows = await tx.unsafe<Row[]>(
    `select ${SELECT}, created_at::text as cursor_ts
       from public.customers
      where organization_id = app.current_org_id()
        and deleted_at is null
        and ($1::text is null or status = $1)
        and ($2::text is null or geocode_status = $2)
        and ($3::text is null
             or lower(legal_name) like $3
             or lower(coalesce(trade_name, '')) like $3
             or lower(coalesce(contact_name, '')) like $3
             or lower(coalesce(email, '')) like $3
             or ($4::text <> '' and document like $4 || '%')
             or ($5::text <> '' and length($5) >= 4 and (phone like '%' || $5 || '%' or whatsapp like '%' || $5 || '%')))
        and ($6::timestamptz is null or (created_at, id) < ($6::timestamptz, $7::uuid))
      order by created_at desc, id desc
      limit $8`,
    [
      f.status ?? null,
      f.geocodeStatus ?? null,
      like,
      docTerm.length >= 3 ? docTerm : '',
      digits,
      f.cursor?.createdAt ?? null,
      f.cursor?.id ?? null,
      f.limit,
    ],
  );
  return rows.map((r) => ({ ...mapCustomer(r), cursorTs: r.cursor_ts as string }));
}

export async function countCustomersByStatus(tx: Tx): Promise<Record<string, number>> {
  const rows = await tx<{ status: string; total: number }[]>`
    select status, count(*)::int as total from public.customers
     where organization_id = app.current_org_id() and deleted_at is null
     group by status
  `;
  return Object.fromEntries(rows.map((r) => [r.status, r.total]));
}

export async function listPendingGeocode(tx: Tx, organizationId: string, limit: number): Promise<string[]> {
  const rows = await tx<{ id: string }[]>`
    select id from public.customers
     where organization_id = ${organizationId} and deleted_at is null and anonymized_at is null
       and geocode_status in ('PENDING', 'FAILED')
     order by updated_at asc
     limit ${limit}
  `;
  return rows.map((r) => r.id);
}

export async function linkCustomerUser(tx: Tx, organizationId: string, customerId: string, userId: string): Promise<void> {
  await tx`
    insert into public.customer_users (organization_id, customer_id, user_id)
    values (${organizationId}, ${customerId}, ${userId})
    on conflict (organization_id, user_id) do nothing
  `;
}

export async function listCustomerUsers(tx: Tx, customerId: string) {
  return tx<{ user_id: string; full_name: string | null; created_at: Date }[]>`
    select cu.user_id, p.full_name, cu.created_at
      from public.customer_users cu
      left join public.profiles p on p.id = cu.user_id
     where cu.customer_id = ${customerId} and cu.organization_id = app.current_org_id()
     order by cu.created_at
  `;
}
