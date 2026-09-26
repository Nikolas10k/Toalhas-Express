import { route } from '@/server/http/route';
import { getSql } from '@/server/db/client';

export const dynamic = 'force-dynamic';

/** Liveness + checagem mínima do banco. Não expõe versões nem detalhes. */
export const GET = route({
  auth: 'public',
  rateLimit: false,
  handler: async () => {
    let database: 'ok' | 'unavailable' = 'ok';
    try {
      await getSql()`select 1`;
    } catch {
      database = 'unavailable';
    }
    return { status: database === 'ok' ? 'ok' : 'degraded', database };
  },
});
