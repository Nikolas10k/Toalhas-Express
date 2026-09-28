import { describe, expect, it, vi } from 'vitest';
import { allowedDecisions, formatIncidentNumber, INCIDENT_STATUSES, incidentStateMachine } from '@/server/modules/incidents/incidents.domain';
import { SupabaseStorageProvider } from '@/server/providers/supabase-storage-provider';

vi.mock('@/server/core/env', () => ({ getServerEnv: () => ({}) }));
const { detectImageType } = await import('@/server/modules/attachments/attachments.service');

describe('máquina de estados de ocorrências (SPEC §7)', () => {
  const table: Record<string, string[]> = {
    OPEN: ['UNDER_REVIEW', 'RESOLVED', 'CANCELLED'],
    UNDER_REVIEW: ['OPEN', 'RESOLVED', 'CANCELLED'],
    RESOLVED: [],
    CANCELLED: [],
  };
  it('aceita exatamente a tabela', () => {
    for (const f of INCIDENT_STATUSES) for (const t of INCIDENT_STATUSES) expect(incidentStateMachine.canTransition(f, t), `${f}→${t}`).toBe(table[f]!.includes(t));
  });
});

describe('decisões por tipo', () => {
  const base = { quantity: 3, productId: 'p', customerId: 'c' };
  it('dano: destino da toalha; falta na coleta/perda: seguir com o cliente ou registrar perda', () => {
    expect(allowedDecisions({ ...base, type: 'DAMAGED' })).toEqual(['RETURN_TO_LAUNDRY', 'RETURN_TO_STOCK', 'DISCARD', 'CHARGE_CUSTOMER']);
    expect(allowedDecisions({ ...base, type: 'QUANTITY_DIVERGENCE', stage: 'COLLECTION' })).toEqual(['NO_ACTION', 'REGISTER_LOSS']);
    expect(allowedDecisions({ ...base, type: 'NOT_RETURNED' })).toEqual(['NO_ACTION', 'REGISTER_LOSS']);
  });
  it('entrega a menor, problemas de endereço e ocorrências sem quantidade não movem estoque', () => {
    expect(allowedDecisions({ ...base, type: 'QUANTITY_DIVERGENCE', stage: 'DELIVERY' })).toEqual(['NO_ACTION']);
    expect(allowedDecisions({ ...base, type: 'ADDRESS_PROBLEM' })).toEqual(['NO_ACTION']);
    expect(allowedDecisions({ ...base, type: 'DAMAGED', quantity: 0 })).toEqual(['NO_ACTION']);
    expect(allowedDecisions({ ...base, type: 'LOST', customerId: null })).toEqual(['NO_ACTION']);
  });
  it('número formatado', () => expect(formatIncidentNumber(42)).toBe('OC-00042'));
});

describe('upload de fotos', () => {
  it('tipo real pelos bytes, não pela extensão', () => {
    expect(detectImageType(new Uint8Array([0xff, 0xd8, 0xff, 0xe1]))).toBe('image/jpeg');
    expect(detectImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toBe('image/png');
    expect(detectImageType(new TextEncoder().encode('RIFF1234WEBPVP8 '))).toBe('image/webp');
    expect(detectImageType(new TextEncoder().encode('<svg onload=alert(1)>'))).toBeNull();
    expect(detectImageType(new TextEncoder().encode('%PDF-1.7'))).toBeNull();
  });

  it('Supabase Storage: nome aleatório, sem sobrescrever, chave só no header; URL assinada completa', async () => {
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes('/sign/')
        ? new Response(JSON.stringify({ signedURL: '/object/sign/operation-proofs/a/b.jpg?token=t' }), { status: 200 })
        : new Response('{}', { status: 200 }),
    );
    const p = new SupabaseStorageProvider('https://x.supabase.co', 'service-key', fetchImpl as unknown as typeof fetch);
    const stored = await p.upload({ bucket: 'operation-proofs', data: new Uint8Array([1, 2]), contentType: 'image/jpeg', prefix: 'org/2026-09' });
    expect(stored.path).toMatch(/^org\/2026-09\/[0-9a-f-]{36}\.jpg$/);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`https://x.supabase.co/storage/v1/object/operation-proofs/${stored.path}`);
    expect((init.headers as Record<string, string>)['x-upsert']).toBe('false');
    expect(url).not.toContain('service-key');
    expect(await p.createSignedUrl('operation-proofs', 'a/b.jpg', 300)).toBe('https://x.supabase.co/storage/v1/object/sign/operation-proofs/a/b.jpg?token=t');
  });
});
