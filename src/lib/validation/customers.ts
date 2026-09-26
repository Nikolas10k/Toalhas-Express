import { z } from 'zod';
import { UFS, normalizeCep } from '@/lib/br/address';
import { detectDocumentType, normalizeDocument } from '@/lib/br/documents';
import { normalizePhone } from '@/lib/br/phone';

/**
 * Schemas compartilhados (formulários e API). Recebem texto livre e devolvem
 * valores NORMALIZADOS (documento só com dígitos/letras, telefone em +55, CEP
 * com 8 dígitos). A API usa strictObject: campos extras são rejeitados.
 */
const trimmed = (max: number) => z.string().trim().max(max);
const optionalText = (max: number) =>
  z
    .string()
    .trim()
    .max(max)
    .optional()
    .nullable()
    .transform((v) => (v ? v : null));

export const documentSchema = z
  .string()
  .trim()
  .min(1, 'Informe o CPF ou CNPJ.')
  .transform((v, ctx) => {
    const doc = normalizeDocument(v);
    if (!detectDocumentType(doc)) {
      ctx.addIssue({ code: 'custom', message: 'CPF ou CNPJ inválido.' });
      return z.NEVER;
    }
    return doc;
  });

export const phoneSchema = z
  .string()
  .trim()
  .max(30)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const p = normalizePhone(v);
    if (!p) {
      ctx.addIssue({ code: 'custom', message: 'Telefone inválido. Use DDD + número.' });
      return z.NEVER;
    }
    return p;
  });

export const cepSchema = z
  .string()
  .trim()
  .max(12)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    const c = normalizeCep(v);
    if (!c) {
      ctx.addIssue({ code: 'custom', message: 'CEP inválido.' });
      return z.NEVER;
    }
    return c;
  });

export const optionalEmailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .max(254)
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!z.email().safeParse(v).success) {
      ctx.addIssue({ code: 'custom', message: 'E-mail inválido.' });
      return z.NEVER;
    }
    return v;
  });

export const ufSchema = z
  .string()
  .trim()
  .toUpperCase()
  .optional()
  .nullable()
  .transform((v, ctx) => {
    if (!v) return null;
    if (!(UFS as readonly string[]).includes(v)) {
      ctx.addIssue({ code: 'custom', message: 'UF inválida.' });
      return z.NEVER;
    }
    return v;
  });

export const COMMUNICATION_CHANNELS = ['WHATSAPP', 'EMAIL', 'PHONE', 'NONE'] as const;
export type CommunicationChannel = (typeof COMMUNICATION_CHANNELS)[number];

export const addressFields = {
  postalCode: cepSchema,
  street: optionalText(200),
  number: optionalText(20),
  complement: optionalText(100),
  district: optionalText(100),
  city: optionalText(100),
  state: ufSchema,
};

export const contactFields = {
  contactName: optionalText(150),
  phone: phoneSchema,
  whatsapp: phoneSchema,
  email: optionalEmailSchema,
};

export const preferenceFields = {
  preferredChannel: z.enum(COMMUNICATION_CHANNELS).default('WHATSAPP'),
  whatsappOptIn: z.boolean().default(false),
  emailOptIn: z.boolean().default(false),
};

const customerBase = {
  personType: z.enum(['PF', 'PJ']),
  legalName: trimmed(200).min(2, 'Informe o nome ou razão social.'),
  tradeName: optionalText(200),
  document: documentSchema,
  ...contactFields,
  ...addressFields,
  ...preferenceFields,
  notes: optionalText(2000),
};

function checkDocumentMatchesType(v: { personType: 'PF' | 'PJ'; document: string }, ctx: z.RefinementCtx) {
  const type = detectDocumentType(v.document);
  if ((v.personType === 'PF' && type !== 'CPF') || (v.personType === 'PJ' && type !== 'CNPJ')) {
    ctx.addIssue({
      code: 'custom',
      path: ['document'],
      message: v.personType === 'PF' ? 'Pessoa física exige CPF.' : 'Pessoa jurídica exige CNPJ.',
    });
  }
}

/** Criação por admin/gerente. */
export const customerCreateSchema = z.strictObject(customerBase).superRefine(checkDocumentMatchesType);
export type CustomerCreateInput = z.input<typeof customerCreateSchema>;
export type CustomerCreateData = z.output<typeof customerCreateSchema>;

/** Alteração parcial por admin/gerente (documento e tipo não mudam por aqui). */
export const customerUpdateSchema = z.strictObject({
  legalName: customerBase.legalName.optional(),
  tradeName: customerBase.tradeName.optional(),
  contactName: contactFields.contactName.optional(),
  phone: contactFields.phone.optional(),
  whatsapp: contactFields.whatsapp.optional(),
  email: contactFields.email.optional(),
  postalCode: addressFields.postalCode.optional(),
  street: addressFields.street.optional(),
  number: addressFields.number.optional(),
  complement: addressFields.complement.optional(),
  district: addressFields.district.optional(),
  city: addressFields.city.optional(),
  state: addressFields.state.optional(),
  preferredChannel: z.enum(COMMUNICATION_CHANNELS).optional(),
  whatsappOptIn: z.boolean().optional(),
  emailOptIn: z.boolean().optional(),
  notes: customerBase.notes.optional(),
});
export type CustomerUpdateData = z.output<typeof customerUpdateSchema>;

/** Auto cadastro (portal público). */
export const selfSignupSchema = z
  .strictObject({
    email: z.string().trim().toLowerCase().max(254).pipe(z.email({ message: 'Informe um e-mail válido.' })),
    password: z
      .string()
      .min(12, 'Use pelo menos 12 caracteres.')
      .max(200)
      .refine((v) => /[a-z]/.test(v) && /[A-Z]/.test(v) && /\d/.test(v), {
        message: 'Use letras maiúsculas, minúsculas e números.',
      }),
    personType: customerBase.personType,
    legalName: customerBase.legalName,
    tradeName: customerBase.tradeName,
    document: customerBase.document,
    contactName: contactFields.contactName,
    phone: contactFields.phone,
    whatsapp: contactFields.whatsapp,
    ...addressFields,
    whatsappOptIn: z.boolean().default(false),
    emailOptIn: z.boolean().default(false),
    acceptTerms: z.literal(true, { message: 'É necessário aceitar os termos e a política de privacidade.' }),
  })
  .superRefine(checkDocumentMatchesType);
export type SelfSignupInput = z.input<typeof selfSignupSchema>;

/** O cliente pode alterar apenas contato e preferências pelo portal. */
export const portalCustomerUpdateSchema = z.strictObject({
  contactName: contactFields.contactName.optional(),
  phone: contactFields.phone.optional(),
  whatsapp: contactFields.whatsapp.optional(),
  email: contactFields.email.optional(),
  preferredChannel: z.enum(COMMUNICATION_CHANNELS).optional(),
  whatsappOptIn: z.boolean().optional(),
  emailOptIn: z.boolean().optional(),
});
export type PortalCustomerUpdate = z.output<typeof portalCustomerUpdateSchema>;

export const CUSTOMER_STATUS_ACTIONS = ['approve', 'reject', 'suspend', 'reactivate', 'inactivate'] as const;
export const customerStatusActionSchema = z.strictObject({
  action: z.enum(CUSTOMER_STATUS_ACTIONS),
  reason: z.string().trim().min(3, 'Informe o motivo.').max(500),
});

export const customerLocationSchema = z.strictObject({
  latitude: z.number().min(-34.0).max(5.5),
  longitude: z.number().min(-74.0).max(-28.5),
  reason: z.string().trim().min(3).max(300),
});
