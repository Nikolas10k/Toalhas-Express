/**
 * Parser CSV (RFC 4180) com detecção de delimitador (, ; tab), BOM e CRLF.
 * Sem dependências. Limites defensivos contra arquivos abusivos.
 */
export interface CsvParseResult {
  delimiter: ',' | ';' | '\t';
  headers: string[];
  rows: string[][];
}

export class CsvError extends Error {}

export const CSV_LIMITS = { maxRows: 5000, maxColumns: 60, maxCellLength: 2000 } as const;

function detectDelimiter(text: string): CsvParseResult['delimiter'] {
  const firstLine: string[] = [];
  let inQuotes = false;
  for (const ch of text) {
    if (ch === '"') inQuotes = !inQuotes;
    else if (!inQuotes && (ch === '\n' || ch === '\r')) break;
    firstLine.push(ch);
  }
  const count = (d: string) => firstLine.filter((c) => c === d).length;
  const candidates: CsvParseResult['delimiter'][] = [';', ',', '\t'];
  return candidates.reduce((best, d) => (count(d) > count(best) ? d : best), ';');
}

export function parseCsv(input: string): CsvParseResult {
  const text = input.replace(/^﻿/, '');
  if (text.trim() === '') throw new CsvError('Arquivo vazio.');
  const delimiter = detectDelimiter(text);
  const records: string[][] = [];
  let field = '';
  let record: string[] = [];
  let inQuotes = false;

  const pushField = () => {
    if (field.length > CSV_LIMITS.maxCellLength) throw new CsvError(`Célula maior que ${CSV_LIMITS.maxCellLength} caracteres.`);
    record.push(field);
    if (record.length > CSV_LIMITS.maxColumns) throw new CsvError(`Mais de ${CSV_LIMITS.maxColumns} colunas.`);
    field = '';
  };
  const pushRecord = () => {
    pushField();
    if (!(record.length === 1 && record[0]!.trim() === '')) records.push(record);
    if (records.length > CSV_LIMITS.maxRows + 1) throw new CsvError(`Mais de ${CSV_LIMITS.maxRows} linhas.`);
    record = [];
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += ch;
      continue;
    }
    if (ch === '"' && field === '') inQuotes = true;
    else if (ch === delimiter) pushField();
    else if (ch === '\n') pushRecord();
    else if (ch === '\r') {
      if (text[i + 1] === '\n') i++;
      pushRecord();
    } else field += ch;
  }
  if (inQuotes) throw new CsvError('Aspas não fechadas no arquivo.');
  if (field !== '' || record.length > 0) pushRecord();

  const [header, ...rows] = records;
  if (!header) throw new CsvError('Arquivo sem cabeçalho.');
  const headers = header.map((h, i) => h.trim() || `Coluna ${i + 1}`);
  if (new Set(headers).size !== headers.length) throw new CsvError('Cabeçalho com colunas repetidas.');
  return { delimiter, headers, rows };
}

/** Gera CSV (separador ;) com escape correto e proteção contra CSV injection. */
export function toCsv(headers: string[], rows: (string | number | null | undefined)[][]): string {
  const esc = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? '' : String(v);
    // Fórmulas começando com = + - @ viram texto no Excel.
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[";\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return '﻿' + [headers, ...rows].map((r) => r.map(esc).join(';')).join('\r\n');
}

/** Decodifica bytes: UTF-8 estrito; se inválido, Windows-1252 (Excel BR). */
export function decodeCsvBytes(bytes: Uint8Array): string {
  if (bytes.includes(0)) throw new CsvError('Arquivo binário não é um CSV.');
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return new TextDecoder('windows-1252').decode(bytes);
  }
}
