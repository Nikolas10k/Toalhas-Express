'use client';

import { Camera, Loader2, X } from 'lucide-react';
import { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';

const MAX_SIDE = 1600;

/**
 * Reduz a foto no aparelho (≤ 1600 px, JPEG) antes de enviar: upload rápido
 * no 4G e sem metadados EXIF (a localização vai no registro, não na imagem).
 */
async function downscale(file: File): Promise<Blob> {
  try {
    const bitmap = await createImageBitmap(file);
    const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    canvas.getContext('2d')!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('blob'))), 'image/jpeg', 0.82));
  } catch {
    return file;
  }
}

async function upload(blob: Blob): Promise<string> {
  const form = new FormData();
  form.append('file', blob, 'foto.jpg');
  const res = await fetch('/api/uploads', { method: 'POST', body: form, credentials: 'same-origin' });
  const payload = (await res.json().catch(() => null)) as { data?: { id: string }; error?: { code: string; message: string } } | null;
  if (!res.ok || !payload?.data) throw new ApiError(res.status, payload?.error?.code ?? 'UNKNOWN', payload?.error?.message ?? 'Falha ao enviar a foto.');
  return payload.data.id;
}

export interface PickedPhoto {
  id: string;
  preview: string;
}

export function PhotoPicker({ photos, onChange, max = 3, label = 'Foto' }: { photos: PickedPhoto[]; onChange: (p: PickedPhoto[]) => void; max?: number; label?: string }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    setError(null);
    const added: PickedPhoto[] = [];
    try {
      for (const f of Array.from(files).slice(0, max - photos.length)) {
        const blob = await downscale(f);
        added.push({ id: await upload(blob), preview: URL.createObjectURL(blob) });
      }
    } catch (e) {
      setError(e instanceof ApiError ? e.message : 'Não foi possível enviar a foto. Tente de novo.');
    } finally {
      onChange([...photos, ...added]);
      setBusy(false);
      if (input.current) input.current.value = '';
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-2">
        {photos.map((p) => (
          <div key={p.id} className="relative size-20 overflow-hidden rounded-md border">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={p.preview} alt="Foto enviada" className="size-full object-cover" />
            <button
              type="button"
              aria-label="Remover foto"
              className="absolute right-0.5 top-0.5 rounded-full bg-background/90 p-0.5"
              onClick={() => onChange(photos.filter((x) => x.id !== p.id))}
            >
              <X className="size-3.5" aria-hidden />
            </button>
          </div>
        ))}
        {photos.length < max && (
          <Button type="button" variant="outline" className="size-20 flex-col gap-1 text-xs" disabled={busy} onClick={() => input.current?.click()}>
            {busy ? <Loader2 className="animate-spin" aria-hidden /> : <Camera aria-hidden />}
            {busy ? 'Enviando' : label}
          </Button>
        )}
      </div>
      <input ref={input} type="file" accept="image/jpeg,image/png,image/webp" capture="environment" multiple hidden onChange={(e) => onFiles(e.target.files)} />
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}
