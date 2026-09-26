/** Contrato de armazenamento privado (Supabase Storage — fotos de prova, comprovantes). */
export interface StoredObject {
  bucket: string;
  path: string;
  contentType: string;
  sizeBytes: number;
}

export interface StorageProvider {
  readonly name: string;
  /** O nome interno é sempre aleatório; nunca derivado do nome enviado pelo usuário. */
  upload(input: { bucket: string; data: Uint8Array; contentType: string; prefix: string }): Promise<StoredObject>;
  createSignedUrl(bucket: string, path: string, expiresInSeconds: number): Promise<string>;
}
