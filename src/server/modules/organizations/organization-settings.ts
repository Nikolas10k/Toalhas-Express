import 'server-only';
import { z } from 'zod';
import { toDbContext, type AuthenticatedActor } from '@/server/auth/actor';
import { authorize } from '@/server/authz/authorize';
import { getServerEnv } from '@/server/core/env';
import type { Tx } from '@/server/db/client';
import { withActorTransaction } from '@/server/db/transaction';
import { recordAudit } from '@/server/modules/audit/audit.service';

/** Configurações por organização (jsonb). Valores ausentes caem nos padrões seguros. */
export const organizationSettingsSchema = z.object({
  customers: z
    .object({
      selfSignupEnabled: z.boolean().default(false),
      requireApproval: z.boolean().default(true),
    })
    .prefault({}),
});
export type OrganizationSettings = z.infer<typeof organizationSettingsSchema>;

export function parseSettings(raw: unknown): OrganizationSettings {
  const parsed = organizationSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : organizationSettingsSchema.parse({});
}

export async function readSettings(tx: Tx, organizationId: string): Promise<OrganizationSettings> {
  const [row] = await tx<{ settings: unknown }[]>`select settings from public.organizations where id = ${organizationId}`;
  return parseSettings(row?.settings);
}

export async function getOrganizationSettings(actor: AuthenticatedActor) {
  authorize(actor, 'organization.read');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const [row] = await tx<{ name: string; slug: string; settings: unknown }[]>`
      select name, slug, settings from public.organizations where id = app.current_org_id()
    `;
    const env = getServerEnv();
    return {
      name: row?.name ?? '',
      slug: row?.slug ?? '',
      settings: parseSettings(row?.settings),
      publicSignupUrl: env.PUBLIC_SIGNUP_ORG_SLUG === row?.slug ? new URL('/cadastro', env.APP_URL).toString() : null,
    };
  });
}

export const customerSettingsSchema = z.strictObject({
  selfSignupEnabled: z.boolean(),
  requireApproval: z.boolean(),
});

export async function updateCustomerSettings(actor: AuthenticatedActor, input: z.infer<typeof customerSettingsSchema>) {
  authorize(actor, 'organization.manage');
  return withActorTransaction(toDbContext(actor), async (tx) => {
    const before = await readSettings(tx, actor.organizationId);
    await tx`
      update public.organizations
         set settings = jsonb_set(coalesce(settings, '{}'::jsonb), '{customers}', ${tx.json(input)}, true)
       where id = app.current_org_id()
    `;
    await recordAudit(tx, actor, actor.organizationId, {
      action: 'organization.settings_updated',
      entityType: 'organization',
      entityId: actor.organizationId,
      before: before.customers,
      after: input,
    });
    return { customers: input };
  });
}
