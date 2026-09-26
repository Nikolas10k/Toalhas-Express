import { customerCreateSchema, type CustomerCreateData } from '@/lib/validation/customers';
import { detectDocumentType, normalizeDocument } from '@/lib/br/documents';

export const IMPORT_FIELDS = {
  document: { label: 'CPF/CNPJ', required: true, synonyms: ['cpf', 'cnpj', 'cpf cnpj', 'documento', 'doc', 'cpf ou cnpj'] },
  legalName: {
    label: 'Nome / Razão social',
    required: true,
    synonyms: ['nome', 'razao social', 'nome completo', 'cliente', 'nome cliente', 'nome razao social'],
  },
  tradeName: { label: 'Nome fantasia', required: false, synonyms: ['nome fantasia', 'fantasia', 'estabelecimento'] },
  personType: { label: 'Tipo (PF/PJ)', required: false, synonyms: ['tipo', 'tipo pessoa', 'pf pj', 'pessoa'] },
  contactName: { label: 'Responsável', required: false, synonyms: ['responsavel', 'contato', 'nome contato'] },
  phone: { label: 'Telefone', required: false, synonyms: ['telefone', 'fone', 'tel', 'telefone fixo'] },
  whatsapp: { label: 'WhatsApp', required: false, synonyms: ['whatsapp', 'whats', 'celular', 'zap', 'wpp'] },
  email: { label: 'E-mail', required: false, synonyms: ['email', 'e mail', 'correio eletronico'] },
  postalCode: { label: 'CEP', required: false, synonyms: ['cep', 'codigo postal'] },
  street: { label: 'Logradouro', required: false, synonyms: ['endereco', 'logradouro', 'rua', 'avenida'] },
  number: { label: 'Número', required: false, synonyms: ['numero', 'num', 'n', 'no'] },
  complement: { label: 'Complemento', required: false, synonyms: ['complemento', 'compl'] },
  district: { label: 'Bairro', required: false, synonyms: ['bairro'] },
  city: { label: 'Cidade', required: false, synonyms: ['cidade', 'municipio'] },
  state: { label: 'UF', required: false, synonyms: ['uf', 'estado'] },
  notes: { label: 'Observações', required: false, synonyms: ['observacoes', 'observacao', 'obs', 'notas'] },
} as const;

export type ImportField = keyof typeof IMPORT_FIELDS;
export type ImportMapping = Partial<Record<ImportField, string>>;
export const DUPLICATE_STRATEGIES = ['ONLY_NEW', 'UPDATE_DUPLICATES', 'ONLY_UPDATE'] as const;
export type DuplicateStrategy = (typeof DUPLICATE_STRATEGIES)[number];

export function normalizeHeader(h: string): string {
  return h
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Sugere mapeamento coluna → campo pelos nomes do cabeçalho. */
export function suggestMapping(headers: string[]): ImportMapping {
  const mapping: ImportMapping = {};
  const used = new Set<string>();
  for (const [field, def] of Object.entries(IMPORT_FIELDS) as [ImportField, (typeof IMPORT_FIELDS)[ImportField]][]) {
    const match = headers.find((h) => !used.has(h) && (def.synonyms as readonly string[]).includes(normalizeHeader(h)));
    if (match) {
      mapping[field] = match;
      used.add(match);
    }
  }
  return mapping;
}

export function validateMapping(mapping: ImportMapping, headers: string[]): string[] {
  const errors: string[] = [];
  for (const [field, def] of Object.entries(IMPORT_FIELDS) as [ImportField, { label: string; required: boolean }][]) {
    if (def.required && !mapping[field]) errors.push(`Mapeie a coluna de "${def.label}".`);
  }
  const values = Object.values(mapping).filter(Boolean) as string[];
  for (const v of values) if (!headers.includes(v)) errors.push(`Coluna "${v}" não existe no arquivo.`);
  if (new Set(values).size !== values.length) errors.push('A mesma coluna foi usada para mais de um campo.');
  return errors;
}

function parsePersonType(raw: string | undefined, document: string): 'PF' | 'PJ' | null {
  const v = raw ? normalizeHeader(raw) : '';
  if (['pf', 'fisica', 'pessoa fisica', 'f'].includes(v)) return 'PF';
  if (['pj', 'juridica', 'pessoa juridica', 'j'].includes(v)) return 'PJ';
  const t = detectDocumentType(document);
  return t === 'CPF' ? 'PF' : t === 'CNPJ' ? 'PJ' : null;
}

export interface RowIssue {
  field: string;
  message: string;
}

export interface NormalizedRow {
  data: CustomerCreateData | null;
  /** Campos preenchidos no arquivo (para atualizar só o que veio). */
  providedFields: string[];
  document: string | null;
  errors: RowIssue[];
}

/** Converte uma linha crua em cliente validado (mesmo schema do cadastro manual). */
export function normalizeRow(raw: Record<string, string>, mapping: ImportMapping): NormalizedRow {
  const get = (f: ImportField) => {
    const h = mapping[f];
    const v = h ? raw[h] : undefined;
    return v === undefined || v.trim() === '' ? undefined : v.trim();
  };
  const document = get('document') ? normalizeDocument(get('document')!) : null;
  const candidate: Record<string, unknown> = {
    personType: parsePersonType(get('personType'), document ?? '') ?? undefined,
    legalName: get('legalName') ?? '',
    tradeName: get('tradeName') ?? null,
    document: get('document') ?? '',
    contactName: get('contactName') ?? null,
    phone: get('phone') ?? null,
    whatsapp: get('whatsapp') ?? null,
    email: get('email') ?? null,
    postalCode: get('postalCode') ?? null,
    street: get('street') ?? null,
    number: get('number') ?? null,
    complement: get('complement') ?? null,
    district: get('district') ?? null,
    city: get('city') ?? null,
    state: get('state') ?? null,
    notes: get('notes') ?? null,
    // Importação nunca presume consentimento de comunicação (LGPD).
    whatsappOptIn: false,
    emailOptIn: false,
    preferredChannel: 'NONE',
  };
  const providedFields = (Object.keys(IMPORT_FIELDS) as ImportField[]).filter((f) => get(f) !== undefined);
  const parsed = customerCreateSchema.safeParse(candidate);
  if (!parsed.success) {
    return {
      data: null,
      providedFields,
      document,
      errors: parsed.error.issues.map((i) => ({
        field: String(i.path[0] ?? 'linha'),
        message: i.path[0] === 'personType' ? 'Tipo PF/PJ não identificado.' : i.message,
      })),
    };
  }
  return { data: parsed.data, providedFields, document: parsed.data.document, errors: [] };
}

export type RowAction = 'INSERT' | 'UPDATE' | 'SKIP' | 'REJECT';

export function decideAction(opts: {
  valid: boolean;
  duplicateInFile: boolean;
  existingCustomerId: string | null;
  strategy: DuplicateStrategy;
}): RowAction {
  if (!opts.valid || opts.duplicateInFile) return 'REJECT';
  if (opts.existingCustomerId) return opts.strategy === 'ONLY_NEW' ? 'SKIP' : 'UPDATE';
  return opts.strategy === 'ONLY_UPDATE' ? 'SKIP' : 'INSERT';
}

/** Na atualização por importação, só campos presentes no arquivo são alterados. */
export function importUpdatePatch(data: CustomerCreateData, providedFields: string[]): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const f of providedFields) {
    if (f === 'document' || f === 'personType') continue;
    patch[f] = (data as Record<string, unknown>)[f];
  }
  return patch;
}
