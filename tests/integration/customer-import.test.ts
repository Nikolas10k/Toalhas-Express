import { beforeAll, describe, expect, it } from 'vitest';
import type { UserActor } from '@/server/auth/actor';
import { AuthorizationError, BusinessRuleError, ValidationError } from '@/server/core/errors';
import { resolveUserActor } from '@/server/modules/access/access.service';
import { createCustomer } from '@/server/modules/customers/customers.service';
import {
  cancelCustomerImport,
  commitCustomerImport,
  listCustomerImportRows,
  rejectedRowsCsv,
  uploadCustomerImport,
  validateCustomerImport,
} from '@/server/modules/customers/import.service';
import { customerCreateSchema } from '@/lib/validation/customers';
import { formatDocument } from '@/lib/br/documents';
import { nextCnpj, nextCpf } from '../helpers/documents';
import { createOrg, createUserInOrg, sql } from './fixtures';

let org: string;
let admin: UserActor;
let driver: UserActor;

beforeAll(async () => {
  org = await createOrg('imp');
  admin = (await resolveUserActor({ userId: (await createUserInOrg(org, ['ADMIN'])).userId, aal: 'aal2' }, org))!;
  driver = (await resolveUserActor({ userId: (await createUserInOrg(org, ['DRIVER'])).userId, aal: 'aal1' }, org))!;
});

const csvFile = (content: string, name = 'clientes.csv') => ({
  name,
  type: 'text/csv',
  bytes: new TextEncoder().encode(content),
});

describe('importação CSV de clientes', () => {
  it('fluxo completo: upload → mapeamento → validação → duplicados → commit → relatório', async () => {
    const existingDoc = nextCnpj();
    const { id: existingId } = await createCustomer(
      admin,
      customerCreateSchema.parse({ personType: 'PJ', legalName: 'Barbearia Antiga', document: existingDoc, city: 'Santos', state: 'SP' }),
    );
    const newPj = nextCnpj();
    const newPf = nextCpf();
    const csv = [
      'Razão Social;CNPJ/CPF;Telefone;Cidade;UF;Obs',
      `Spa Serenidade;${formatDocument(newPj)};(11) 3333-4444;São Paulo;SP;`,
      `Maria Clara;${newPf};11987654321;Campinas;sp;cliente antiga`,
      `Barbearia Nova Razão;${existingDoc};;Guarujá;SP;`,
      `;123;abc;X;ZZ;`,
      `Spa Duplicado;${newPj};;;;`,
    ].join('\r\n');

    const up = await uploadCustomerImport(admin, csvFile(csv));
    expect(up.rowCount).toBe(5);
    expect(up.suggestedMapping).toMatchObject({ legalName: 'Razão Social', phone: 'Telefone', city: 'Cidade', state: 'UF', notes: 'Obs' });

    // "CNPJ/CPF" não bate com sinônimo exato → usuário mapeia manualmente.
    const mapping = { ...up.suggestedMapping, document: 'CNPJ/CPF' };
    const { summary } = await validateCustomerImport(admin, up.importId, { mapping, strategy: 'UPDATE_DUPLICATES' });
    expect(summary).toEqual({ total: 5, insert: 2, update: 1, skip: 0, reject: 2 });

    const rejected = await listCustomerImportRows(admin, up.importId, { filter: 'rejected', page: 1 });
    expect(rejected.items.map((r) => r.rowNumber)).toEqual([4, 5]);
    expect(rejected.items[1]!.errors[0]!.message).toMatch(/repetido no arquivo \(linha 1\)/);

    const first = await commitCustomerImport(admin, up.importId);
    expect(first.summary).toMatchObject({ imported: 2, updated: 1, skipped: 0, rejected: 2 });
    // Commit repetido (retry/duplo clique) não duplica nada.
    const again = await commitCustomerImport(admin, up.importId);
    expect(again.alreadyCommitted).toBe(true);
    const created = await sql`select document, source, import_id, whatsapp_opt_in from public.customers where import_id = ${up.importId} order by document`;
    expect(created).toHaveLength(2);
    expect(created.every((c) => c.source === 'IMPORT' && c.whatsapp_opt_in === false)).toBe(true);

    const [updated] = await sql`select legal_name, city from public.customers where id = ${existingId}`;
    expect(updated).toMatchObject({ legal_name: 'Barbearia Nova Razão', city: 'Guarujá' });

    const report = await rejectedRowsCsv(admin, up.importId);
    expect(report.content).toContain('linha;erros');
    expect(report.content.split('\r\n')).toHaveLength(3);

    const audits = await sql`select action from public.audit_logs where metadata->>'import_id' = ${up.importId} or entity_id = ${up.importId}`;
    expect(audits.map((a) => a.action).sort()).toEqual(
      ['customer.created', 'customer.created', 'customer.updated', 'customer_import.committed', 'customer_import.uploaded'].sort(),
    );
    await expect(cancelCustomerImport(admin, up.importId)).rejects.toBeInstanceOf(BusinessRuleError);
  });

  it('estratégia "só novos" ignora duplicados; "só atualizar" ignora novos', async () => {
    const doc = nextCnpj();
    await createCustomer(admin, customerCreateSchema.parse({ personType: 'PJ', legalName: 'Clínica A', document: doc }));
    const csv = `nome;cnpj\nClínica A2;${doc}\nClínica B;${nextCnpj()}`;
    const a = await uploadCustomerImport(admin, csvFile(csv));
    expect((await validateCustomerImport(admin, a.importId, { mapping: a.suggestedMapping, strategy: 'ONLY_NEW' })).summary).toMatchObject({ insert: 1, skip: 1 });
    expect((await validateCustomerImport(admin, a.importId, { mapping: a.suggestedMapping, strategy: 'ONLY_UPDATE' })).summary).toMatchObject({ update: 1, skip: 1 });
  });

  it('rejeita arquivos inválidos e mapeamento incompleto', async () => {
    await expect(uploadCustomerImport(admin, csvFile('a;b\n1;2', 'x.xlsx'))).rejects.toBeInstanceOf(ValidationError);
    await expect(uploadCustomerImport(admin, { ...csvFile('a;b\n1;2'), type: 'application/pdf' })).rejects.toBeInstanceOf(ValidationError);
    await expect(uploadCustomerImport(admin, csvFile('nome;cpf\n'))).rejects.toThrow(/não tem linhas/);
    await expect(uploadCustomerImport(admin, { name: 'x.csv', type: 'text/csv', bytes: new Uint8Array([1, 0, 2]) })).rejects.toThrow(/binário/);
    const up = await uploadCustomerImport(admin, csvFile('nome;obs\nA;B'));
    await expect(validateCustomerImport(admin, up.importId, { mapping: { legalName: 'nome' }, strategy: 'ONLY_NEW' })).rejects.toThrow(/CPF\/CNPJ/);
    await expect(commitCustomerImport(admin, up.importId)).rejects.toThrow(/Valide/);
  });

  it('motorista não importa', async () => {
    await expect(uploadCustomerImport(driver, csvFile('nome;cpf\nA;1'))).rejects.toBeInstanceOf(AuthorizationError);
  });
});
