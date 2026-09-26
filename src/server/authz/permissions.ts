/**
 * Catálogo de permissões. Espelha `public.permissions` (migration
 * 20260926000200); um teste de integração garante que os dois não divergem.
 */
export const PERMISSIONS = [
  'admin.access',
  'organization.read',
  'organization.manage',
  'users.read',
  'users.manage',
  'permissions.manage',
  'integrations.manage',
  'automations.manage',
  'audit.read',
  'customer.read',
  'customer.create',
  'customer.update',
  'customer.approve',
  'customer.import',
  'customer.export',
  'customer.anonymize',
  'product.read',
  'product.manage',
  'inventory.read',
  'inventory.move',
  'inventory.adjust',
  'inventory.adjust_large',
  'laundry.read',
  'laundry.manage',
  'order.read',
  'order.create',
  'order.create_draft',
  'order.update',
  'order.cancel',
  'order.override_stock',
  'route.read',
  'route.manage',
  'driver.manage',
  'vehicle.manage',
  'driver_app.access',
  'operation.execute',
  'incident.read',
  'incident.report',
  'incident.manage',
  'contract.read',
  'contract.manage',
  'finance.read',
  'finance.create_charge',
  'finance.cancel_charge',
  'finance.register_manual_payment',
  'finance.refund',
  'finance.reconcile',
  'reports.read',
  'reports.export',
  'notifications.manage',
  'notifications.callback',
  'jobs.run',
  'portal.access',
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Permissões que exigem MFA recente (step-up) a cada uso. */
export const STEP_UP_PERMISSIONS: ReadonlySet<Permission> = new Set<Permission>([
  'organization.manage',
  'users.manage',
  'permissions.manage',
  'integrations.manage',
  'customer.export',
  'customer.anonymize',
  'inventory.adjust_large',
  'order.override_stock',
  'finance.cancel_charge',
  'finance.register_manual_payment',
  'finance.refund',
  'reports.export',
]);

const PERMISSION_SET: ReadonlySet<string> = new Set(PERMISSIONS);

export function isPermission(value: string): value is Permission {
  return PERMISSION_SET.has(value);
}
