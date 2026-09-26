import 'server-only';
import { randomUUID } from 'node:crypto';
import type { z } from 'zod';
import type { selfSignupSchema } from '@/lib/validation/customers';
import { sha256Hex } from '@/server/core/crypto';
import { BusinessRuleError, ProviderError } from '@/server/core/errors';
import { getServerEnv } from '@/server/core/env';
import { logger } from '@/server/core/logger';
import { getRequestContext } from '@/server/core/request-context';
import { withSystemTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';
import { readSettings } from '@/server/modules/organizations/organization-settings';
import { hitRateLimit } from '@/server/modules/rate-limit/rate-limit.service';
import { createSupabaseServerClient } from '@/server/supabase/server';
import { existsByDocument, linkCustomerUser } from './customers.repository';
import { insertNewCustomer } from './customers.service';

type SignupData = z.output<typeof selfSignupSchema>;

export const SIGNUP_RATE_LIMITS = {
  byIp: { name: 'customer.signup:ip', max: 5, windowSeconds: 3600 },
  byDocument: { name: 'customer.signup:doc', max: 3, windowSeconds: 86400 },
} as const;

/** Mensagem única para qualquer desfecho (anti-enumeração de e-mail/documento). */
export const SIGNUP_RESPONSE =
  'Recebemos seu cadastro. Confirme seu e-mail pelo link enviado para acessar o portal.';

export async function getSignupAvailability(): Promise<{ enabled: boolean; organizationName: string | null }> {
  const slug = getServerEnv().PUBLIC_SIGNUP_ORG_SLUG;
  if (!slug) return { enabled: false, organizationName: null };
  return withSystemTransaction(async (tx) => {
    const [org] = await tx<{ id: string; name: string }[]>`
      select id, name from public.organizations where slug = ${slug} and status = 'active' and deleted_at is null
    `;
    if (!org) return { enabled: false, organizationName: null };
    const settings = await readSettings(tx, org.id);
    return { enabled: settings.customers.selfSignupEnabled, organizationName: org.name };
  });
}

/**
 * Auto cadastro: cria usuário no Supabase Auth (e-mail de confirmação), o
 * cliente (pending ou active conforme configuração), o vínculo CUSTOMER e o
 * acesso ao portal — tudo no banco em UMA transação.
 */
export async function selfSignup(data: SignupData): Promise<{ message: string }> {
  const env = getServerEnv();
  const ip = getRequestContext()?.ip ?? 'unknown';
  await hitRateLimit(SIGNUP_RATE_LIMITS.byIp, ip);
  await hitRateLimit(SIGNUP_RATE_LIMITS.byDocument, data.document);

  const slug = env.PUBLIC_SIGNUP_ORG_SLUG;
  const org = slug
    ? await withSystemTransaction(async (tx) => {
        const [o] = await tx<{ id: string }[]>`
          select id from public.organizations where slug = ${slug} and status = 'active' and deleted_at is null
        `;
        if (!o) return null;
        return { id: o.id, settings: await readSettings(tx, o.id), docExists: await existsByDocument(tx, o.id, data.document) };
      })
    : null;
  if (!org || !org.settings.customers.selfSignupEnabled) {
    throw new BusinessRuleError('O cadastro online não está disponível no momento. Fale com a Toalhas Express.');
  }

  const docFp = sha256Hex(`${env.APP_HASH_PEPPER}:doc:${data.document}`).slice(0, 16);
  if (org.docExists) {
    await withSystemTransaction((tx) =>
      recordAudit(tx, { type: 'ANONYMOUS' }, org.id, {
        action: 'customer.signup_duplicate_document',
        entityType: 'customer',
        metadata: { document_fp: docFp },
      }),
    );
    return { message: SIGNUP_RESPONSE };
  }

  const supabase = await createSupabaseServerClient();
  const { data: auth, error } = await supabase.auth.signUp({
    email: data.email,
    password: data.password,
    options: { emailRedirectTo: new URL('/auth/confirm?next=/portal', env.APP_URL).toString() },
  });
  if (error) {
    if ((error.status ?? 500) >= 500) throw new ProviderError('supabase_auth', `signUp falhou: ${error.status}`);
    logger.warn('customer.signup_auth_rejected', { status: error.status, code: error.code });
    throw new BusinessRuleError('Não foi possível concluir o cadastro. Verifique os dados e tente novamente.');
  }
  // E-mail já registrado: o Supabase devolve usuário sem identidades.
  if (!auth.user || (auth.user.identities?.length ?? 0) === 0) return { message: SIGNUP_RESPONSE };

  const userId = auth.user.id;
  const status = org.settings.customers.requireApproval ? 'pending' : 'active';
  try {
    await withSystemTransaction(async (tx) => {
      await tx`insert into public.profiles (id, full_name, phone) values (${userId}, ${data.contactName ?? data.legalName}, ${data.phone ?? null}) on conflict (id) do nothing`;
      const memberId = randomUUID();
      await tx`
        insert into public.organization_members (id, organization_id, user_id, status)
        values (${memberId}, ${org.id}, ${userId}, 'active')
      `;
      await tx`
        insert into public.member_roles (organization_id, member_id, role_id)
        select ${org.id}, ${memberId}, r.id from public.roles r where r.organization_id = ${org.id} and r.code = 'CUSTOMER'
      `;
      // Contexto de org para as consultas que usam app.current_org_id().
      await tx`select set_config('app.org_id', ${org.id}, true)`;
      const customerId = await insertNewCustomer(
        tx,
        org.id,
        {
          personType: data.personType,
          legalName: data.legalName,
          tradeName: data.tradeName,
          document: data.document,
          contactName: data.contactName,
          phone: data.phone,
          whatsapp: data.whatsapp,
          email: data.email,
          postalCode: data.postalCode,
          street: data.street,
          number: data.number,
          complement: data.complement,
          district: data.district,
          city: data.city,
          state: data.state,
          preferredChannel: data.whatsappOptIn ? 'WHATSAPP' : data.emailOptIn ? 'EMAIL' : 'NONE',
          whatsappOptIn: data.whatsappOptIn,
          emailOptIn: data.emailOptIn,
          notes: null,
        },
        { status, source: 'SELF_SIGNUP', consentSource: 'SELF_SIGNUP', createdBy: userId },
      );
      await linkCustomerUser(tx, org.id, customerId, userId);
      await recordAudit(tx, { type: 'USER', userId }, org.id, {
        action: 'customer.self_signup',
        entityType: 'customer',
        entityId: customerId,
        after: { status, person_type: data.personType, terms_accepted_at: new Date().toISOString() },
      });
    });
  } catch (err) {
    // Usuário de Auth já foi criado; sem vínculo ele não acessa nada. Fica no log para limpeza.
    logger.error('customer.signup_db_failed', { user_id: userId, error: err });
    throw err;
  }
  return { message: SIGNUP_RESPONSE };
}
