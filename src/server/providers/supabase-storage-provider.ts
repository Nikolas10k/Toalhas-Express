import 'server-only';
import { randomUUID } from 'node:crypto';
import { ProviderError } from '@/server/core/errors';
import type { StorageProvider, StoredObject } from './storage-provider';

const EXT: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/**
 * Supabase Storage via REST com a service role (somente no servidor). Os
 * buckets são privados: leitura apenas por signed URL de curta duração.
 */
export class SupabaseStorageProvider implements StorageProvider {
  readonly name = 'supabase_storage';

  constructor(
    private readonly baseUrl: string,
    private readonly serviceKey: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private headers(extra: Record<string, string> = {}) {
    return { authorization: `Bearer ${this.serviceKey}`, apikey: this.serviceKey, ...extra };
  }

  async upload(input: { bucket: string; data: Uint8Array; contentType: string; prefix: string }): Promise<StoredObject> {
    // Nome interno aleatório; nada do nome original do arquivo é usado.
    const path = `${input.prefix}/${randomUUID()}.${EXT[input.contentType] ?? 'bin'}`;
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/storage/v1/object/${input.bucket}/${path}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(20_000),
        headers: this.headers({ 'content-type': input.contentType, 'x-upsert': 'false', 'cache-control': 'private, max-age=0' }),
        body: input.data as unknown as BodyInit,
      });
    } catch (err) {
      throw new ProviderError(this.name, 'Falha de rede no upload', { cause: err });
    }
    if (!res.ok) throw new ProviderError(this.name, `Upload HTTP ${res.status}`, { retryable: res.status >= 500 || res.status === 429 });
    return { bucket: input.bucket, path, contentType: input.contentType, sizeBytes: input.data.byteLength };
  }

  async createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string> {
    let res: Response;
    try {
      res = await this.fetchImpl(`${this.baseUrl}/storage/v1/object/sign/${bucket}/${path}`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(10_000),
        headers: this.headers({ 'content-type': 'application/json' }),
        body: JSON.stringify({ expiresIn: expiresInSeconds }),
      });
    } catch (err) {
      throw new ProviderError(this.name, 'Falha de rede ao assinar URL', { cause: err });
    }
    if (!res.ok) throw new ProviderError(this.name, `Signed URL HTTP ${res.status}`, { retryable: res.status >= 500 });
    const body = (await res.json()) as { signedURL?: string };
    if (!body.signedURL) throw new ProviderError(this.name, 'Signed URL ausente', { retryable: false });
    return `${this.baseUrl}/storage/v1${body.signedURL}`;
  }
}
