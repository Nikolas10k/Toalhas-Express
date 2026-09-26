import { describe, expect, it } from 'vitest';
import { formatCep, formatAddress, normalizeCep } from '@/lib/br/address';
import { detectDocumentType, formatDocument, isValidCnpj, isValidCpf, normalizeDocument } from '@/lib/br/documents';
import { formatPhone, isMobile, normalizePhone } from '@/lib/br/phone';
import { makeCnpj, makeCpf } from '../helpers/documents';

describe('CPF/CNPJ', () => {
  it('valida CPF', () => {
    expect(isValidCpf('529.982.247-25')).toBe(true);
    expect(isValidCpf('529.982.247-26')).toBe(false);
    expect(isValidCpf('111.111.111-11')).toBe(false);
    expect(isValidCpf(makeCpf(123))).toBe(true);
  });

  it('valida CNPJ numérico e alfanumérico (RFB 2026)', () => {
    expect(isValidCnpj('11.222.333/0001-81')).toBe(true);
    expect(isValidCnpj('11.222.333/0001-82')).toBe(false);
    expect(isValidCnpj('12.ABC.345/01DE-35')).toBe(true);
    expect(isValidCnpj('12abc34501de35')).toBe(true);
    expect(isValidCnpj(makeCnpj(42, true))).toBe(true);
    expect(isValidCnpj('00.000.000/0000-00')).toBe(false);
  });

  it('normaliza, detecta e formata', () => {
    expect(normalizeDocument(' 12.abc.345/01de-35 ')).toBe('12ABC34501DE35');
    expect(detectDocumentType('529.982.247-25')).toBe('CPF');
    expect(detectDocumentType('11222333000181')).toBe('CNPJ');
    expect(detectDocumentType('123')).toBeNull();
    expect(formatDocument('52998224725')).toBe('529.982.247-25');
    expect(formatDocument('12ABC34501DE35')).toBe('12.ABC.345/01DE-35');
  });
});

describe('telefone', () => {
  it.each([
    ['(11) 98765-4321', '+5511987654321'],
    ['11 3333-4444', '+551133334444'],
    ['+55 21 99999-8888', '+5521999998888'],
    ['0 21 11 98765-4321', '+5511987654321'],
    ['55 99123-4567', '+5555991234567'],
    ['(10) 98765-4321', null],
    ['(11) 88765-4321', null],
    ['1234', null],
    ['', null],
  ])('%s → %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('formata e identifica celular', () => {
    expect(formatPhone('+5511987654321')).toBe('(11) 98765-4321');
    expect(formatPhone('+551133334444')).toBe('(11) 3333-4444');
    expect(isMobile('+5511987654321')).toBe(true);
    expect(isMobile('+551133334444')).toBe(false);
  });
});

describe('endereço', () => {
  it('CEP e endereço formatado', () => {
    expect(normalizeCep('01310-100')).toBe('01310100');
    expect(normalizeCep('0131')).toBeNull();
    expect(formatCep('01310100')).toBe('01310-100');
    expect(
      formatAddress({ street: 'Av. Paulista', number: '1000', complement: 'sala 1', district: 'Bela Vista', city: 'São Paulo', state: 'SP', postalCode: '01310100' }),
    ).toBe('Av. Paulista, 1000 - sala 1, Bela Vista, São Paulo - SP, 01310-100');
  });
});
