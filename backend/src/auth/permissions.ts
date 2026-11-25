import type { Role } from '../../generated/prisma/client.js'

// Single source of truth for what each role may do. Every API route checks
// one of these with requirePermission(); the frontend only mirrors them.
const ALL_ROLES: Role[] = ['TENANT_ADMIN', 'DATA_ENTRY', 'REVIEWER', 'VERIFIER']

export const PERMISSIONS = {
  'org.read': ALL_ROLES,
  'org.manage': ['TENANT_ADMIN'],
  'users.manage': ['TENANT_ADMIN'],
  'facility.manage': ['TENANT_ADMIN'],
  'period.manage': ['TENANT_ADMIN'],
  'period.lock': ['TENANT_ADMIN', 'REVIEWER'],
  'source.manage': ['TENANT_ADMIN'],
  'activity.read': ALL_ROLES,
  'activity.write': ['TENANT_ADMIN', 'DATA_ENTRY'],
  'activity.submit': ['TENANT_ADMIN', 'DATA_ENTRY'],
  'activity.review': ['TENANT_ADMIN', 'REVIEWER'],
  'evidence.read': ALL_ROLES,
  'evidence.write': ['TENANT_ADMIN', 'DATA_ENTRY'],
  'factor.read': ALL_ROLES,
  // The organisation's own factors (TC-ARC-006 section 5). Nobody deletes a factor; Super Admin has no access to them.
  'factor.write': ['TENANT_ADMIN', 'DATA_ENTRY', 'REVIEWER'], // create drafts, attach evidence, submit for review
  'factor.approve': ['REVIEWER'], // approve or return; edit an approved factor not yet in use. Never their own.
  'factor.supersede': ['TENANT_ADMIN', 'REVIEWER'], // end-date or replace
  'fuel.write': ['TENANT_ADMIN', 'DATA_ENTRY'], // record monthly laboratory fuel properties (Tier 3)
  'fuel.approve': ['TENANT_ADMIN', 'REVIEWER'], // approve them so calculations apply them
  'calc.read': ['TENANT_ADMIN', 'REVIEWER', 'VERIFIER'],
  'calc.run': ['TENANT_ADMIN', 'REVIEWER'],
  'report.read': ['TENANT_ADMIN', 'REVIEWER', 'VERIFIER'], // view and export; verifiers: granted periods only
  'verifier.manage': ['TENANT_ADMIN'], // grant verifiers access to reporting periods
  'query.read': ['TENANT_ADMIN', 'REVIEWER', 'VERIFIER'],
  'query.create': ['VERIFIER'], // raise, follow up and close
  'notification.read': ALL_ROLES,
  'audit.read': ['TENANT_ADMIN', 'REVIEWER', 'VERIFIER'],
  'quality.read': ['TENANT_ADMIN', 'REVIEWER', 'DATA_ENTRY'], // data quality dashboard
  'quality.manage': ['TENANT_ADMIN', 'REVIEWER'], // mark findings as needing no change
  'reconcile.read': ['TENANT_ADMIN', 'REVIEWER', 'DATA_ENTRY'], // view, start and add sources
  'reconcile.resolve': ['TENANT_ADMIN', 'REVIEWER'], // decide the correct value
  'insight.use': ['TENANT_ADMIN', 'REVIEWER'], // recommendations, scenarios, intensity and targets
  'renewables.read': ['TENANT_ADMIN', 'REVIEWER'], // renewable instrument register and Scope 2 coverage
  'renewables.manage': ['TENANT_ADMIN'], // register, retire and allocate instruments
} satisfies Record<string, Role[]>

export type Permission = keyof typeof PERMISSIONS

export const can = (role: Role, permission: Permission) =>
  (PERMISSIONS[permission] as Role[]).includes(role)

export const permissionsFor = (role: Role) =>
  (Object.keys(PERMISSIONS) as Permission[]).filter((p) => can(role, p))
