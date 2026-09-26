import 'server-only';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { toDbContext, type UserActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { sha256Hex } from '@/server/core/crypto';
import { BusinessRuleError, NotFoundError, ValidationError } from '@/server/core/errors';
import type { Tx } from '@/server/db/client';
import { withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import type { CustomerCreateData } from '@/lib/validation/customers';
import { CSV_LIMITS, CsvError, decodeCsvBytes, parseCsv, toCsv } from './csv';
import { findCustomerById, findCustomersByDocuments } from './customers.repository';
import { insertNewCustomer } from './customers.service';
import {
  DUPLICATE_STRATEGIES,
  IMPORT_FIELDS,
  decideAction,
  importUpdatePatch,
  normalizeRow,
  suggestMapping,
  validateMapping,
  type DuplicateStrategy,
  type ImportField,
  type ImportMapping,
  type RowIssue,
} from './import.domain';
import { diffFields, addressChanged, hasGeocodableAddress } from './customers.domain';
import { updateCustomer } from './customers.repository';
import { enqueueCustomerGeocode } from './geocoding.service';

export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;
const ALLOWED_MIME = new Set(['text/csv', 'application/vnd.ms-excel', 'text/plain', 'application/csv', '']);

export const importConfigSchema = z.strictObject({
  mapping: z.partialRecord(z.enum(Object.keys(IMPORT_FIELDS) as [ImportField, ...ImportField[]]), z.string().max(200)),
  strategy: z.enum(DUPLICATE_STRATEGIES),
});

export const importRowsQuerySchema = z.strictObject({
  filter: z.enum(['all', 'rejected', 'insert', 'update', 'skip']).default('all'),
  page: z.coerce.number().int().min(1).max(1000).default(1),
});

interface ImportRow {
  id: string;
  status: string;
  file_name: string;
  headers: string[];
  row_count: number;
  mapping: ImportMapping | null;
  duplicate_strategy: DuplicateStrategy | null;
  summary: Record<string, number>;
  created_at: Date;
  validated_at: Date | null;
  committed_at: Date | null;
}

async function loadImport(tx: Tx, id: string, forUpdate = false): Promise<ImportRow> {
  const rows = await tx.unsafe<ImportRow[]>(
    `select id, status, file_name, headers, row_count, mapping, duplicate_strategy, summary, created_at, validated_at, committed_at
       from public.customer_imports where id = $1 and organization_id = app.current_org_id() ${forUpdate ? 'for update' : ''}`,
    [id],
  );
  if (!rows[0]) throw new NotFoundError('Importação não encontrada.');
  return rows[0];
}

function importDto(i: ImportRow) {
  return {
    id: i.id,
    status: i.status,
    fileName: i.file_name,
    headers: i.headers,
    rowCount: i.row_count,
    mapping: i.mapping,
    strategy: i.duplicate_strategy,
    summary: i.summary,
    createdAt: i.created_at.toISOString(),
    validatedAt: i.validated_at?.toISOString() ?? null,
    committedAt: i.committed_at?.toISOString() ?? null,
  };
}

/** Etapa 1 — upload: valida arquivo, faz parse e guarda as linhas cruas. */
export async function uploadCustomerImport(actor: UserActor, file: { name: string; type: string; bytes: Uint8Array }) {
  authorize(actor, 'customer.import');
  if (!/\.csv$/i.test(file.name) || file.name.length > 255) {
    throw new ValidationError('Envie um arquivo .csv.', [{ path: 'file', message: 'extensão inválida' }]);
  }
  if (!ALLOWED_MIME.has(file.type)) {
    throw new ValidationError('Tipo de arquivo não permitido.', [{ path: 'file', message: 'tipo inválido' }]);
  }
  if (file.bytes.byteLength === 0 || file.bytes.byteLength > MAX_IMPORT_BYTES) {
    throw new ValidationError('O arquivo deve ter até 2 MB.', [{ path: 'file', message: 'tamanho inválido' }]);
  }
  let parsed;
  try {
    parsed = parseCsv(decodeCsvBytes(file.bytes));
  } catch (err) {
    if (err instanceof CsvError) throw new ValidationError(`CSV inválido: ${err.message}`, [{ path: 'file', message: err.message }]);
    throw err;
  }
  if (parsed.rows.length === 0) throw new ValidationError('O arquivo não tem linhas de dados.');
  if (parsed.rows.length > CSV_LIMITS.maxRows) throw new ValidationError(`Máximo de ${CSV_LIMITS.maxRows} linhas por importação.`);

  const importId = randomUUID();
  const safeName = file.name.replace(/[^\w.\- ]/g, '_');
  const objects = parsed.rows.map((cells, idx) => ({
    row_number: idx + 1,
    raw: Object.fromEntries(parsed.headers.map((h, i) => [h, (cells[i] ?? '').trim()])),
  }));

  await withActorTransaction(toDbContext(actor), async (tx) => {
    await tx`
      insert into public.customer_imports (id, organization_id, file_name, file_sha256, delimiter, headers, row_count, created_by)
      values (${importId}, ${actor.organizationId}, ${safeName}, ${sha256Hex(Buffer.from(file.bytes).toString('latin1'))},
              ${parsed.delimiter}, ${tx.json(parsed.headers)}, ${parsed.rows.length}, ${actor.userId})
    `;
    for (let i = 0; i < objects.length; i += 500) {
      await tx`
        insert into public.customer_import_rows (organization_id, import_id, row_number, raw)
        select ${actor.organizationId}, ${importId}, x.row_number, x.raw
          from jsonb_to_recordset(${tx.json(objects.slice(i, i + 500))}) as x(row_number int, raw jsonb)
      `;
    }
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer_import.uploaded',
      entityType: 'customer_import',
      entityId: importId,
      metadata: { file_name: safeName, rows: parsed.rows.length },
    });
  });

  return {
    importId,
    headers: parsed.headers,
    rowCount: parsed.rows.length,
    preview: objects.slice(0, 10).map((o) => o.raw),
    suggestedMapping: suggestMapping(parsed.headers),
  };
}

export async function getCustomerImport(actor: UserActor, id: string) {
  authorize(actor, 'customer.import');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const imp = await loadImport(tx, id);
    const preview = await tx<{ raw: Record<string, string> }[]>`
      select raw from public.customer_import_rows where import_id = ${id} order by row_number limit 10
    `;
    return { ...importDto(imp), preview: preview.map((p) => p.raw), suggestedMapping: suggestMapping(imp.headers) };
  });
}

export async function listCustomerImports(actor: UserActor) {
  authorize(actor, 'customer.import');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const rows = await tx<ImportRow[]>`
      select id, status, file_name, headers, row_count, mapping, duplicate_strategy, summary, created_at, validated_at, committed_at
        from public.customer_imports where organization_id = app.current_org_id()
       order by created_at desc limit 50
    `;
    return rows.map(importDto);
  });
}

/** Etapas 2-4 — mapeamento, validação, duplicados e escolha da estratégia. */
export async function validateCustomerImport(actor: UserActor, id: string, config: z.infer<typeof importConfigSchema>) {
  authorize(actor, 'customer.import');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const imp = await loadImport(tx, id, true);
    if (imp.status !== 'UPLOADED' && imp.status !== 'VALIDATED') {
      throw new BusinessRuleError('Esta importação já foi concluída ou cancelada.');
    }
    const mapping = Object.fromEntries(Object.entries(config.mapping).filter(([, v]) => v)) as ImportMapping;
    const mappingErrors = validateMapping(mapping, imp.headers);
    if (mappingErrors.length) {
      throw new ValidationError(mappingErrors[0]!, mappingErrors.map((m) => ({ path: 'mapping', message: m })));
    }

    const rows = await tx<{ row_number: number; raw: Record<string, string> }[]>`
      select row_number, raw from public.customer_import_rows where import_id = ${id} order by row_number
    `;
    const normalized = rows.map((r) => ({ rowNumber: r.row_number, ...normalizeRow(r.raw, mapping) }));
    const existing = await findCustomersByDocuments(
      tx,
      [...new Set(normalized.map((n) => n.document).filter((d): d is string => Boolean(d)))],
    );

    const firstSeen = new Map<string, number>();
    const summary = { total: rows.length, insert: 0, update: 0, skip: 0, reject: 0 };
    const updates = normalized.map((n) => {
      const errors: RowIssue[] = [...n.errors];
      let dupOf: number | null = null;
      if (n.data && n.document) {
        const seen = firstSeen.get(n.document);
        if (seen !== undefined) {
          dupOf = seen;
          errors.push({ field: 'document', message: `CPF/CNPJ repetido no arquivo (linha ${seen}).` });
        } else firstSeen.set(n.document, n.rowNumber);
      }
      const existingId = n.document ? (existing.get(n.document) ?? null) : null;
      const action = decideAction({
        valid: n.errors.length === 0,
        duplicateInFile: dupOf !== null,
        existingCustomerId: existingId,
        strategy: config.strategy,
      });
      summary[action.toLowerCase() as keyof typeof summary] += 1;
      return {
        row_number: n.rowNumber,
        normalized: n.data ? { data: n.data, providedFields: n.providedFields } : null,
        errors,
        duplicate_customer_id: existingId,
        duplicate_in_file_of: dupOf,
        action,
      };
    });

    for (let i = 0; i < updates.length; i += 500) {
      await tx`
        update public.customer_import_rows r
           set normalized = x.normalized, errors = x.errors, duplicate_customer_id = x.duplicate_customer_id,
               duplicate_in_file_of = x.duplicate_in_file_of, action = x.action, result = null, result_customer_id = null
          from jsonb_to_recordset(${tx.json(updates.slice(i, i + 500) as never)})
               as x(row_number int, normalized jsonb, errors jsonb, duplicate_customer_id uuid, duplicate_in_file_of int, action text)
         where r.import_id = ${id} and r.row_number = x.row_number
      `;
    }
    await tx`
      update public.customer_imports
         set status = 'VALIDATED', mapping = ${tx.json(mapping)}, duplicate_strategy = ${config.strategy},
             summary = ${tx.json(summary)}, validated_at = now()
       where id = ${id}
    `;
    return { summary };
  });
}

export async function listCustomerImportRows(actor: UserActor, id: string, q: z.infer<typeof importRowsQuerySchema>) {
  authorize(actor, 'customer.import');
  const pageSize = 50;
  return withActorTransaction(toDbContext(actor), async (tx) => {
    await loadImport(tx, id);
    const FILTER_ACTION = { all: null, rejected: 'REJECT', insert: 'INSERT', update: 'UPDATE', skip: 'SKIP' } as const;
    const action = FILTER_ACTION[q.filter];
    const rows = await tx<
      { row_number: number; raw: Record<string, string>; errors: RowIssue[]; action: string | null; result: string | null; duplicate_customer_id: string | null; result_customer_id: string | null }[]
    >`
      select row_number, raw, errors, action, result, duplicate_customer_id, result_customer_id
        from public.customer_import_rows
       where import_id = ${id} and (${action}::text is null or action = ${action})
       order by row_number
       limit ${pageSize + 1} offset ${(q.page - 1) * pageSize}
    `;
    return {
      items: rows.slice(0, pageSize).map((r) => ({
        rowNumber: r.row_number,
        raw: r.raw,
        errors: r.errors,
        action: r.action,
        result: r.result,
        existingCustomerId: r.duplicate_customer_id,
        customerId: r.result_customer_id,
      })),
      hasMore: rows.length > pageSize,
    };
  });
}

interface CommitRow {
  id: string;
  row_number: number;
  normalized: { data: CustomerCreateData; providedFields: string[] } | null;
  action: 'INSERT' | 'UPDATE' | 'SKIP' | 'REJECT';
  duplicate_customer_id: string | null;
}

/**
 * Etapa 5 — commit em UMA transação (tudo ou nada), idempotente: repetir o
 * commit de uma importação concluída devolve o mesmo relatório.
 */
export async function commitCustomerImport(actor: UserActor, id: string) {
  authorize(actor, 'customer.import');
  authorize(actor, 'customer.create');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const imp = await loadImport(tx, id, true);
    if (imp.status === 'COMMITTED') return { summary: imp.summary, alreadyCommitted: true };
    if (imp.status !== 'VALIDATED') throw new BusinessRuleError('Valide a importação antes de concluir.');
    const strategy = imp.duplicate_strategy!;
    const hasUpdates = await tx`select 1 from public.customer_import_rows where import_id = ${id} and action = 'UPDATE' limit 1`;
    if (hasUpdates.length) authorize(actor, 'customer.update');

    const rows = await tx<CommitRow[]>`
      select id, row_number, normalized, action, duplicate_customer_id
        from public.customer_import_rows where import_id = ${id} order by row_number
    `;
    // Revalida duplicados no momento do commit (alguém pode ter cadastrado no meio tempo).
    const docs = rows.map((r) => r.normalized?.data.document).filter((d): d is string => Boolean(d));
    const existingNow = await findCustomersByDocuments(tx, [...new Set(docs)]);

    const report = { imported: 0, updated: 0, skipped: 0, rejected: 0 };
    const results: { id: string; result: string; customer_id: string | null }[] = [];

    for (const row of rows) {
      let action = row.action;
      const data = row.normalized?.data;
      const existingId = data ? (existingNow.get(data.document) ?? null) : null;
      if (action === 'INSERT' && existingId) action = strategy === 'ONLY_NEW' ? 'SKIP' : 'UPDATE';

      if (action === 'REJECT' || !data) {
        report.rejected += 1;
        results.push({ id: row.id, result: 'REJECTED', customer_id: null });
      } else if (action === 'SKIP') {
        report.skipped += 1;
        results.push({ id: row.id, result: 'SKIPPED', customer_id: existingId });
      } else if (action === 'INSERT') {
        const customerId = await insertNewCustomer(tx, actor.organizationId, data, {
          status: 'active',
          source: 'IMPORT',
          consentSource: 'IMPORT',
          createdBy: actor.userId,
          approvedBy: actor.userId,
          importId: id,
        });
        await recordAudit(tx, actor, actor.organizationId, {
          action: 'customer.created',
          entityType: 'customer',
          entityId: customerId,
          after: data,
          metadata: { import_id: id, row: row.row_number },
        });
        report.imported += 1;
        results.push({ id: row.id, result: 'IMPORTED', customer_id: customerId });
      } else {
        const targetId = existingId ?? row.duplicate_customer_id!;
        const current = await findCustomerById(tx, targetId, { forUpdate: true });
        if (!current || current.anonymizedAt) {
          report.skipped += 1;
          results.push({ id: row.id, result: 'SKIPPED', customer_id: targetId });
          continue;
        }
        const patch = importUpdatePatch(data, row.normalized!.providedFields);
        const { before, after } = diffFields(current as unknown as Record<string, unknown>, patch);
        if (Object.keys(after).length > 0) {
          const reGeocode = addressChanged(current as unknown as Record<string, unknown>, after);
          const merged = { ...current, ...after };
          await updateCustomer(tx, targetId, {
            ...after,
            ...(reGeocode
              ? {
                  latitude: null,
                  longitude: null,
                  placeId: null,
                  formattedAddress: null,
                  geocodeStatus: hasGeocodableAddress(merged) ? 'PENDING' : 'SKIPPED',
                }
              : {}),
          });
          if (reGeocode && hasGeocodableAddress(merged)) {
            await enqueueCustomerGeocode(tx, actor.organizationId, targetId, `import:${id}`);
          }
          await recordAudit(tx, actor, actor.organizationId, {
            action: 'customer.updated',
            entityType: 'customer',
            entityId: targetId,
            before,
            after,
            metadata: { import_id: id, row: row.row_number },
          });
        }
        report.updated += 1;
        results.push({ id: row.id, result: 'UPDATED', customer_id: targetId });
      }
    }

    for (let i = 0; i < results.length; i += 500) {
      await tx`
        update public.customer_import_rows r set result = x.result, result_customer_id = x.customer_id
          from jsonb_to_recordset(${tx.json(results.slice(i, i + 500))}) as x(id uuid, result text, customer_id uuid)
         where r.id = x.id
      `;
    }
    const summary = { ...imp.summary, ...report };
    await tx`update public.customer_imports set status = 'COMMITTED', summary = ${tx.json(summary)}, committed_at = now() where id = ${id}`;
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer_import.committed',
      entityType: 'customer_import',
      entityId: id,
      after: report,
      metadata: { strategy, file_name: imp.file_name },
    });
    return { summary, alreadyCommitted: false };
  });
}

export async function cancelCustomerImport(actor: UserActor, id: string) {
  authorize(actor, 'customer.import');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const imp = await loadImport(tx, id, true);
    if (imp.status === 'COMMITTED') throw new BusinessRuleError('Importação concluída não pode ser cancelada.');
    await tx`update public.customer_imports set status = 'CANCELLED' where id = ${id}`;
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'customer_import.cancelled',
      entityType: 'customer_import',
      entityId: id,
    });
    return { status: 'CANCELLED' };
  });
}

/** Relatório CSV das linhas rejeitadas (para o usuário corrigir e reenviar). */
export async function rejectedRowsCsv(actor: UserActor, id: string): Promise<{ fileName: string; content: string }> {
  authorize(actor, 'customer.import');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const imp = await loadImport(tx, id);
    const rows = await tx<{ row_number: number; raw: Record<string, string>; errors: RowIssue[] }[]>`
      select row_number, raw, errors from public.customer_import_rows
       where import_id = ${id} and action = 'REJECT' order by row_number
    `;
    const headers = ['linha', 'erros', ...imp.headers];
    const content = toCsv(
      headers,
      rows.map((r) => [r.row_number, r.errors.map((e) => e.message).join(' | '), ...imp.headers.map((h) => r.raw[h] ?? '')]),
    );
    return { fileName: `rejeitados-${imp.file_name}`, content };
  });
}
