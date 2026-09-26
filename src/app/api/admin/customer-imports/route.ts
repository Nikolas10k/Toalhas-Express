import { ValidationError } from '@/server/core/errors';
import { json, route } from '@/server/http/route';
import {
  MAX_IMPORT_BYTES,
  listCustomerImports,
  uploadCustomerImport,
} from '@/server/modules/customers/import.service';

export const GET = route({
  auth: 'user',
  permission: 'customer.import',
  handler: async ({ actor }) => listCustomerImports(actor),
});

/** Upload multipart (campo "file"). Tamanho, extensão, MIME e conteúdo são validados no service. */
export const POST = route({
  auth: 'user',
  permission: 'customer.import',
  handler: async ({ actor, req }) => {
    const declared = Number(req.headers.get('content-length') ?? '0');
    if (declared > MAX_IMPORT_BYTES + 64 * 1024) throw new ValidationError('O arquivo deve ter até 2 MB.');
    if (!(req.headers.get('content-type') ?? '').startsWith('multipart/form-data')) {
      throw new ValidationError('Envie o arquivo como multipart/form-data.');
    }
    const form = await req.formData();
    const files = form.getAll('file');
    if (files.length !== 1 || !(files[0] instanceof File)) throw new ValidationError('Envie exatamente um arquivo.');
    const file = files[0];
    if (file.size > MAX_IMPORT_BYTES) throw new ValidationError('O arquivo deve ter até 2 MB.');
    const bytes = new Uint8Array(await file.arrayBuffer());
    return json(await uploadCustomerImport(actor, { name: file.name, type: file.type, bytes }), 201);
  },
});
