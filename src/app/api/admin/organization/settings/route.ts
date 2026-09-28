import { z } from 'zod';
import { route } from '@/server/http/route';
import {
  customerSettingsSchema,
  getOrganizationSettings,
  operationSettingsSchema,
  updateCustomerSettings,
  updateOperationSettings,
} from '@/server/modules/organizations/organization-settings';

export const GET = route({
  auth: 'user',
  permission: 'organization.read',
  handler: async ({ actor }) => getOrganizationSettings(actor),
});

export const PATCH = route({
  auth: 'user',
  permission: 'organization.manage',
  body: z.union([z.strictObject({ customers: customerSettingsSchema }), z.strictObject({ operations: operationSettingsSchema })]),
  handler: async ({ actor, body }) =>
    'customers' in body ? updateCustomerSettings(actor, body.customers) : updateOperationSettings(actor, body.operations),
});
