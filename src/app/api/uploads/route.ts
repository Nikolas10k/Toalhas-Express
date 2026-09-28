import { ValidationError } from '@/server/core/errors';
import { json, route } from '@/server/http/route';
import { MAX_UPLOAD_BYTES, uploadPhoto } from '@/server/modules/attachments/attachments.service';

/**
 * Upload de foto (multipart, campo "file"). Tamanho conferido antes e depois
 * de ler; o tipo é validado pelos bytes; o nome enviado é descartado.
 */
export const POST = route({
  auth: 'user',
  handler: async ({ actor, req }) => {
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_UPLOAD_BYTES + 64 * 1024) throw new ValidationError('Foto maior que 5 MB.');
    let form: FormData;
    try {
      form = await req.formData();
    } catch {
      throw new ValidationError('Envie a foto como formulário (multipart/form-data).');
    }
    const files = form.getAll('file');
    if (files.length !== 1 || !(files[0] instanceof Blob)) throw new ValidationError('Envie exatamente uma foto no campo "file".');
    const file = files[0];
    if (file.size > MAX_UPLOAD_BYTES) throw new ValidationError('Foto maior que 5 MB.');
    return json(await uploadPhoto(actor, new Uint8Array(await file.arrayBuffer())), 201);
  },
});
