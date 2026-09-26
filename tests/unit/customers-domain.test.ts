import { describe, expect, it } from 'vitest';
import { BusinessRuleError } from '@/server/core/errors';
import { CsvError, decodeCsvBytes, parseCsv, toCsv } from '@/server/modules/customers/csv';
import {
  addressChanged,
  customerStateMachine,
  diffFields,
  hasGeocodableAddress,
  resolveStatusAction,
  CUSTOMER_STATUSES,
} from '@/server/modules/customers/customers.domain';
import {
  decideAction,
  importUpdatePatch,
  normalizeRow,
  suggestMapping,
  validateMapping,
} from '@/server/modules/customers/import.domain';
import { customerCreateSchema, portalCustomerUpdateSchema, selfSignupSchema } from '@/lib/validation/customers';

describe('status do cliente', () => {
  it('ações válidas', () => {
    expect(resolveStatusAction('pending', 'approve')).toBe('active');
    expect(resolveStatusAction('pending', 'reject')).toBe('inactive');
    expect(resolveStatusAction('active', 'suspend')).toBe('suspended');
    expect(resolveStatusAction('suspended', 'reactivate')).toBe('active');
    expect(resolveStatusAction('inactive', 'reactivate')).toBe('active');
  });

  it('rejeita ações fora do estado', () => {
    expect(() => resolveStatusAction('active', 'approve')).toThrow(BusinessRuleError);
    expect(() => resolveStatusAction('inactive', 'suspend')).toThrow(BusinessRuleError);
    expect(() => resolveStatusAction('pending', 'suspend')).toThrow(BusinessRuleError);
  });

  it('toda transição fora da tabela é rejeitada', () => {
    const allowed = new Set(['pending>active', 'pending>inactive', 'active>suspended', 'active>inactive', 'suspended>active', 'suspended>inactive', 'inactive>active']);
    for (const from of CUSTOMER_STATUSES)
      for (const to of CUSTOMER_STATUSES) expect(customerStateMachine.canTransition(from, to)).toBe(allowed.has(`${from}>${to}`));
  });

  it('diff e mudança de endereço', () => {
    const before = { legalName: 'A', city: 'X', phone: null };
    expect(diffFields(before, { legalName: 'A', city: 'Y', phone: undefined })).toEqual({ before: { city: 'X' }, after: { city: 'Y' } });
    expect(addressChanged(before, { city: 'Y' })).toBe(true);
    expect(addressChanged(before, { legalName: 'B' })).toBe(false);
    expect(hasGeocodableAddress({ postalCode: '01310100' })).toBe(true);
    expect(hasGeocodableAddress({ street: 'Rua', city: 'SP' })).toBe(false);
  });
});

describe('schemas de cliente', () => {
  const base = { personType: 'PJ', legalName: 'Salão Bela', document: '11.222.333/0001-81' };
  it('normaliza campos e exige documento coerente com o tipo', () => {
    const r = customerCreateSchema.parse({ ...base, phone: '(11) 98765-4321', postalCode: '01310-100', state: 'sp', email: ' A@B.COM ' });
    expect(r).toMatchObject({ document: '11222333000181', phone: '+5511987654321', postalCode: '01310100', state: 'SP', email: 'a@b.com', whatsappOptIn: false });
    expect(customerCreateSchema.safeParse({ ...base, personType: 'PF' }).success).toBe(false);
    expect(customerCreateSchema.safeParse({ ...base, document: '11.222.333/0001-82' }).success).toBe(false);
  });

  it('rejeita campos extras (mass assignment)', () => {
    expect(customerCreateSchema.safeParse({ ...base, status: 'active' }).success).toBe(false);
    expect(customerCreateSchema.safeParse({ ...base, organizationId: 'x' }).success).toBe(false);
    expect(portalCustomerUpdateSchema.safeParse({ legalName: 'Outro' }).success).toBe(false);
    expect(portalCustomerUpdateSchema.safeParse({ document: '52998224725' }).success).toBe(false);
  });

  it('auto cadastro exige aceite dos termos e senha forte', () => {
    const s = { ...base, email: 'a@b.com', password: 'SenhaForte2026', acceptTerms: true };
    expect(selfSignupSchema.safeParse(s).success).toBe(true);
    expect(selfSignupSchema.safeParse({ ...s, acceptTerms: false }).success).toBe(false);
    expect(selfSignupSchema.safeParse({ ...s, password: '12345678' }).success).toBe(false);
  });
});

describe('CSV', () => {
  it('detecta ; e lida com aspas, BOM e CRLF', () => {
    const r = parseCsv('﻿nome;cpf;obs\r\n"Silva; Ana";529.982.247-25;"disse ""oi"""\r\n\r\nB;1;\n');
    expect(r.delimiter).toBe(';');
    expect(r.headers).toEqual(['nome', 'cpf', 'obs']);
    expect(r.rows).toEqual([['Silva; Ana', '529.982.247-25', 'disse "oi"'], ['B', '1', '']]);
  });

  it('detecta vírgula e tab', () => {
    expect(parseCsv('a,b\n1,2').delimiter).toBe(',');
    expect(parseCsv('a\tb\n1\t2').rows).toEqual([['1', '2']]);
  });

  it('rejeita arquivos inválidos', () => {
    expect(() => parseCsv('')).toThrow(CsvError);
    expect(() => parseCsv('a;a\n1;2')).toThrow(/repetidas/);
    expect(() => parseCsv('a;b\n"1;2')).toThrow(/Aspas/);
    expect(() => decodeCsvBytes(new Uint8Array([97, 0, 98]))).toThrow(CsvError);
  });

  it('decodifica Windows-1252 (Excel) quando não é UTF-8', () => {
    expect(decodeCsvBytes(new Uint8Array([0x53, 0xe3, 0x6f]))).toBe('São');
  });

  it('toCsv neutraliza fórmulas (CSV injection)', () => {
    const out = toCsv(['a'], [['=HYPERLINK("x")'], ['+1'], ['ok;1']]);
    expect(out).toContain(`"'=HYPERLINK(""x"")"`);
    expect(out).toContain("'+1");
    expect(out).toContain('"ok;1"');
  });
});

describe('importação: mapeamento e linhas', () => {
  const headers = ['Razão Social', 'CNPJ', 'Nome Fantasia', 'Telefone', 'Cidade', 'UF', 'Coluna X'];

  it('sugere mapeamento por sinônimos, ignorando acentos', () => {
    expect(suggestMapping(headers)).toEqual({
      document: 'CNPJ',
      legalName: 'Razão Social',
      tradeName: 'Nome Fantasia',
      phone: 'Telefone',
      city: 'Cidade',
      state: 'UF',
    });
  });

  it('valida mapeamento obrigatório e colunas', () => {
    expect(validateMapping({ legalName: 'Razão Social' }, headers)).toContain('Mapeie a coluna de "CPF/CNPJ".');
    expect(validateMapping({ document: 'CNPJ', legalName: 'CNPJ' }, headers)).toContain('A mesma coluna foi usada para mais de um campo.');
    expect(validateMapping({ document: 'Nope', legalName: 'CNPJ' }, headers)[0]).toMatch(/não existe/);
  });

  it('normaliza linha válida e deduz PF/PJ pelo documento', () => {
    const m = suggestMapping(headers);
    const ok = normalizeRow({ 'Razão Social': 'Barbearia X', CNPJ: '11.222.333/0001-81', Telefone: '11 3333-4444', UF: 'sp' }, m);
    expect(ok.errors).toEqual([]);
    expect(ok.data).toMatchObject({ personType: 'PJ', document: '11222333000181', phone: '+551133334444', state: 'SP', whatsappOptIn: false });
    expect(ok.providedFields.sort()).toEqual(['document', 'legalName', 'phone', 'state']);
  });

  it('linha inválida lista erros por campo (nada é importado em silêncio)', () => {
    const bad = normalizeRow({ 'Razão Social': '', CNPJ: '123', Telefone: 'abc' }, suggestMapping(headers));
    expect(bad.data).toBeNull();
    const fields = bad.errors.map((e) => e.field);
    expect(fields).toEqual(expect.arrayContaining(['legalName', 'document', 'phone']));
  });

  it('decide ação por estratégia', () => {
    const v = { valid: true, duplicateInFile: false };
    expect(decideAction({ ...v, existingCustomerId: null, strategy: 'ONLY_NEW' })).toBe('INSERT');
    expect(decideAction({ ...v, existingCustomerId: 'x', strategy: 'ONLY_NEW' })).toBe('SKIP');
    expect(decideAction({ ...v, existingCustomerId: 'x', strategy: 'UPDATE_DUPLICATES' })).toBe('UPDATE');
    expect(decideAction({ ...v, existingCustomerId: null, strategy: 'ONLY_UPDATE' })).toBe('SKIP');
    expect(decideAction({ valid: false, duplicateInFile: false, existingCustomerId: null, strategy: 'ONLY_NEW' })).toBe('REJECT');
    expect(decideAction({ valid: true, duplicateInFile: true, existingCustomerId: null, strategy: 'ONLY_NEW' })).toBe('REJECT');
  });

  it('atualização por importação só mexe no que veio no arquivo', () => {
    const data = customerCreateSchema.parse({ personType: 'PJ', legalName: 'Xis', document: '11222333000181', city: 'Campinas' });
    expect(importUpdatePatch(data, ['document', 'legalName', 'city'])).toEqual({ legalName: 'Xis', city: 'Campinas' });
  });
});
