import { z } from 'zod';
import { route } from '@/server/http/route';
import {
  customerSettingsSchema,
  getOrganizationSettings,
  updateCustomerSettings,
} from '@/server/modules/organizations/organization-settings';

export const GET = route({
  auth: 'user',
  permission: 'organization.read',
  handler: async ({ actor }) => getOrganizationSettings(actor),
});

export const PATCH = route({
  auth: 'user',
  permission: 'organization.manage',
  body: z.strictObject({ customers: customerSettingsSchema }),
  handler: async ({ actor, body }) => updateCustomerSettings(actor, body.customers),
});
