import 'server-only';
import { formatAddress } from '@/lib/br/address';
import { getServerEnv } from '@/server/core/env';
import { logger } from '@/server/core/logger';
import type { Tx } from '@/server/db/client';
import { withSystemTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { enqueueJob, type JobHandler } from '@/server/modules/jobs/jobs.service';
import { GoogleMapsProvider } from '@/server/providers/google-maps-provider';
import type { MapsProvider } from '@/server/providers/maps-provider';
import { hasGeocodableAddress } from './customers.domain';
import { listPendingGeocode } from './customers.repository';

export const GEOCODE_CUSTOMER_JOB = 'customer.geocode';
export const GEOCODE_PENDING_JOB = 'customers.geocode_pending';

let providerOverride: MapsProvider | null | undefined;

/** Sem chave configurada → null (geocoding fica PENDING; nada falha). */
export function getMapsProvider(): MapsProvider | null {
  if (providerOverride !== undefined) return providerOverride;
  const key = getServerEnv().GOOGLE_MAPS_SERVER_KEY;
  return key ? new GoogleMapsProvider(key) : null;
}

/** Apenas para testes. */
export function setMapsProviderForTesting(p: MapsProvider | null | undefined): void {
  providerOverride = p;
}

/**
 * Enfileira geocoding na MESMA transação da alteração de endereço. A chave
 * inclui updated_at para que uma nova alteração gere novo job, e repetições
 * da mesma alteração não dupliquem.
 */
export async function enqueueCustomerGeocode(tx: Tx, organizationId: string, customerId: string, version: string) {
  await enqueueJob(tx, {
    type: GEOCODE_CUSTOMER_JOB,
    organizationId,
    payload: { customerId },
    idempotencyKey: `${GEOCODE_CUSTOMER_JOB}:${customerId}:${version}`,
    maxAttempts: 6,
  });
}

interface GeocodeTarget {
  id: string;
  organization_id: string;
  street: string | null;
  number: string | null;
  complement: string | null;
  district: string | null;
  city: string | null;
  state: string | null;
  postal_code: string | null;
  geocode_status: string;
  anonymized_at: Date | null;
}

/** Handler do job: geocodifica um cliente. Nunca sobrescreve correção MANUAL. */
export const geocodeCustomerHandler: JobHandler = async ({ job }) => {
  const customerId = String(job.payload.customerId ?? '');
  const provider = getMapsProvider();
  if (!provider) {
    logger.warn('geocode.provider_not_configured', { customer_id: customerId });
    return; // continua PENDING; o lote em massa tenta de novo quando houver chave
  }

  const target = await withSystemTransaction(async (tx) => {
    const rows = await tx<GeocodeTarget[]>`
      select id, organization_id, street, number, complement, district, city, state, postal_code, geocode_status, anonymized_at
        from public.customers where id = ${customerId} and deleted_at is null
    `;
    return rows[0] ?? null;
  });
  if (!target || target.anonymized_at || target.geocode_status === 'MANUAL') return;

  const parts = {
    street: target.street,
    number: target.number,
    district: target.district,
    city: target.city,
    state: target.state,
    postalCode: target.postal_code,
  };
  if (!hasGeocodableAddress(parts)) {
    await withSystemTransaction((tx) =>
      tx`update public.customers set geocode_status = 'SKIPPED', geocoded_at = now() where id = ${customerId} and geocode_status <> 'MANUAL'`,
    );
    return;
  }

  // Erros do provider propagam: o worker agenda retry com backoff.
  const result = await provider.geocode(`${formatAddress(parts)}, Brasil`);

  await withSystemTransaction(async (tx) => {
    // Revalida dentro da transação com lock: se virou MANUAL no meio tempo, não sobrescreve.
    const [current] = await tx<{ geocode_status: string }[]>`
      select geocode_status from public.customers where id = ${customerId} for update
    `;
    if (!current || current.geocode_status === 'MANUAL') return;
    if (!result) {
      await tx`update public.customers set geocode_status = 'NOT_FOUND', geocoded_at = now() where id = ${customerId}`;
    } else {
      await tx`
        update public.customers
           set latitude = ${result.lat}, longitude = ${result.lng}, place_id = ${result.placeId},
               formatted_address = ${result.formattedAddress},
               geocode_status = ${result.partialMatch ? 'PARTIAL' : 'OK'}, geocoded_at = now()
         where id = ${customerId}
      `;
    }
    await recordAudit(tx, { type: 'SYSTEM', reason: 'geocoding' }, target.organization_id, {
      action: 'customer.geocoded',
      entityType: 'customer',
      entityId: customerId,
      after: result
        ? { latitude: result.lat, longitude: result.lng, place_id: result.placeId, partial: result.partialMatch }
        : { geocode_status: 'NOT_FOUND' },
    });
  });
};

/** Geocoding em massa: enfileira um job por cliente pendente (lotes de 200). */
export const geocodePendingHandler: JobHandler = async ({ job }) => {
  const organizationId = job.organization_id;
  if (!organizationId || !getMapsProvider()) return;
  const ids = await withSystemTransaction((tx) => listPendingGeocode(tx, organizationId, 200));
  await withSystemTransaction(async (tx) => {
    const batch = new Date().toISOString().slice(0, 16);
    for (const id of ids) {
      await enqueueJob(tx, {
        type: GEOCODE_CUSTOMER_JOB,
        organizationId,
        payload: { customerId: id },
        idempotencyKey: `${GEOCODE_CUSTOMER_JOB}:${id}:bulk:${batch}`,
        maxAttempts: 6,
      });
    }
  });
};
