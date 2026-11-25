// Platform administration (Super Admin only). Works across organisations by id,
// unlike tenant routes, which are always scoped to the session's organisation.
import { randomBytes } from 'node:crypto'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma } from '../../generated/prisma/client.js'
import { SEALED_PREFIX, hashPassword } from '../auth/crypto.js'
import { aiKeySet } from '../ai/index.js'
import { env } from '../config/env.js'
import { getPrisma, isMySql } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { optionalText } from '../middleware/validate.js'
import { effectiveStatus, orgAccess } from '../services/access.js'
import { writeAudit } from '../services/audit.js'

// MySQL's default collation already ignores case; PostgreSQL needs it asked for.
const contains = (s: string) => (isMySql() ? { contains: s } : { contains: s, mode: 'insensitive' as const })
import { addMember, changeMemberRole, issueTemporaryPassword } from './members.controller.js'
import { updateProfileSchema } from './organizations.controller.js'

const SUB_STATUSES = ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED'] as const

const subscriptionInput = z.object({
  planName: z.string().trim().min(1, 'Enter a plan name').max(100),
  status: z.enum(SUB_STATUSES),
  startDate: z.iso.date('Enter a valid start date'),
  endDate: z.iso.date('Enter a valid end date').nullish().or(z.literal('').transform(() => null)),
}).refine((s) => !s.endDate || s.endDate >= s.startDate, { message: 'End date must be on or after the start date', path: ['endDate'] })

const adminInput = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(200),
})

const toSubData = (s: z.infer<typeof subscriptionInput>) => ({
  planName: s.planName, status: s.status, startDate: new Date(s.startDate), endDate: s.endDate ? new Date(s.endDate) : null,
})

const orgParam = (req: { params: Record<string, unknown> }) => req.params.id as string

async function findOrg(tx: Prisma.TransactionClient, id: string) {
  const org = await tx.organization.findUnique({ where: { id }, include: { subscription: true } })
  if (!org) throw new HttpError(404, 'Organisation not found')
  return org
}

// Adds what the UI needs on top of the stored subscription: the date-aware status and member access.
function describe<T extends { status: 'ACTIVE' | 'SUSPENDED'; subscription: Parameters<typeof orgAccess>[1] }>(org: T) {
  return {
    ...org,
    subscription: org.subscription && { ...org.subscription, effectiveStatus: effectiveStatus(org.subscription) },
    ...orgAccess(org, org.subscription),
  }
}

// ---- Dashboard ----------------------------------------------------------------

export const platformSummary: RequestHandler = async (_req, res) => {
  const db = getPrisma()
  // One COUNT per date-aware status, using the same filter as the organisation list.
  const [orgs, users, superAdmins, ...subCounts] = await Promise.all([
    db.organization.groupBy({ by: ['status'], _count: true }),
    db.user.count(),
    db.user.count({ where: { platformRole: 'SUPER_ADMIN' } }),
    ...SUB_STATUSES.map((s) => db.subscription.count({ where: subscriptionFilter(s) })),
  ])
  const bySub = Object.fromEntries(SUB_STATUSES.map((s, i) => [s, subCounts[i]])) as Record<(typeof SUB_STATUSES)[number], number>
  const orgCount = (s: string) => orgs.find((o) => o.status === s)?._count ?? 0
  res.json({
    organizations: { total: orgCount('ACTIVE') + orgCount('SUSPENDED'), active: orgCount('ACTIVE'), suspended: orgCount('SUSPENDED') },
    users: { total: users, superAdmins },
    subscriptions: { byStatus: bySub, active: bySub.ACTIVE + bySub.TRIAL, inactive: bySub.EXPIRED + bySub.SUSPENDED + bySub.CANCELLED },
  })
}

// ---- Production readiness ---------------------------------------------------------
// What the app can check about its own set-up. Backups, spending limits and monitoring live outside it.

async function auditTriggersInstalled(): Promise<boolean> {
  const db = getPrisma()
  try {
    const rows: Array<{ n: bigint | number }> = isMySql()
      ? await db.$queryRaw`SELECT COUNT(*) AS n FROM information_schema.TRIGGERS WHERE TRIGGER_SCHEMA = DATABASE() AND EVENT_OBJECT_TABLE = 'AuditLog'`
      : await db.$queryRaw`SELECT COUNT(*) AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE c.relname = 'AuditLog' AND NOT t.tgisinternal`
    return Number(rows[0]?.n ?? 0) > 0
  } catch { return false } // no permission to read trigger metadata: report as not confirmed
}

export const platformReadiness: RequestHandler = async (_req, res) => {
  const [triggers, plainSecrets] = await Promise.all([
    auditTriggersInstalled(),
    getPrisma().user.count({ where: { mfaSecret: { not: null }, NOT: { mfaSecret: { startsWith: SEALED_PREFIX } } } }),
  ])
  const keySet = !!env.MFA_ENCRYPTION_KEY
  res.json({ checks: [
    { key: 'mfaKey', ok: keySet && plainSecrets === 0, label: 'Authenticator secrets are encrypted',
      fix: keySet ? `${plainSecrets} account(s) still hold an unencrypted secret; each is encrypted at that person's next sign-in.`
        : 'Add MFA_ENCRYPTION_KEY (a random string of 32 or more characters) to private/.env and restart. Keep a safe copy: losing it means resetting two-step for every user.' },
    { key: 'triggers', ok: triggers, label: 'Audit trail is append-only in the database',
      fix: 'Import deploy-sql/5-triggers.sql in phpMyAdmin. If it reports a missing TRIGGER privilege, ask the host to grant it.' },
    { key: 'bootstrap', ok: !process.env.BOOTSTRAP_ADMIN_PASSWORD, label: 'First admin password removed from settings',
      fix: 'Once the first Super Admin has signed in and changed their password, delete BOOTSTRAP_ADMIN_PASSWORD from private/.env and restart.' },
    { key: 'ai', ok: aiKeySet() && !!env.AI_MODEL, label: 'Document reading is configured',
      fix: 'Set AI_PROVIDER, AI_MODEL and the provider API key in private/.env and restart.' },
  ] })
}

// ---- Organisations ------------------------------------------------------------

export const PAGE_SIZE = 50
const page = z.coerce.number().int().min(1).max(100_000).default(1)
const paged = <T>(rows: T[], total: number, p: number) => ({ rows, total, page: p, pageSize: PAGE_SIZE })

const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  status: z.enum(['ACTIVE', 'SUSPENDED']).optional(),
  subscription: z.enum(SUB_STATUSES).optional(),
  page,
})

// The date-aware subscription status (see effectiveStatus) as a database filter, so paging works.
function subscriptionFilter(s: (typeof SUB_STATUSES)[number]): Prisma.SubscriptionWhereInput {
  const today = new Date(new Date().toISOString().slice(0, 10))
  const current = { OR: [{ endDate: null }, { endDate: { gte: today } }] }
  if (s === 'TRIAL' || s === 'ACTIVE') return { status: s, ...current }
  if (s === 'EXPIRED') return { OR: [{ status: 'EXPIRED' }, { status: { in: ['TRIAL', 'ACTIVE'] }, endDate: { lt: today } }] }
  return { status: s }
}

export const listOrganizations: RequestHandler = async (req, res) => {
  const q = listQuery.parse(req.query)
  const where: Prisma.OrganizationWhereInput = {
    status: q.status,
    ...(q.q ? { OR: [{ name: contains(q.q) }, { legalName: contains(q.q) }] } : {}),
    ...(q.subscription ? { subscription: subscriptionFilter(q.subscription) } : {}),
  }
  const db = getPrisma()
  const [orgs, total] = await Promise.all([
    db.organization.findMany({
      where,
      include: { subscription: true, _count: { select: { memberships: true, facilities: true } } },
      orderBy: { name: 'asc' },
      skip: (q.page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    db.organization.count({ where }),
  ])
  res.json(paged(orgs.map(describe), total, q.page))
}

export const createOrganizationSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name').max(200),
  legalName: optionalText(200),
  country: optionalText(100),
  industry: optionalText(100),
  address: optionalText(500),
  admin: adminInput,
  subscription: subscriptionInput,
})

// Creates the organisation, its subscription and first Tenant Admin together, or nothing.
export const createOrganization: RequestHandler = async (req, res) => {
  const { admin, subscription, ...profile } = req.body as z.infer<typeof createOrganizationSchema>
  const actorUserId = req.auth!.userId
  const result = await getPrisma().$transaction(async (tx) => {
    const org = await tx.organization.create({ data: profile })
    const sub = await tx.subscription.create({ data: { organizationId: org.id, ...toSubData(subscription) } })
    await tx.subscriptionEvent.create({ data: { organizationId: org.id, actorUserId, ...toSubData(subscription), reason: 'Organisation created' } })
    await writeAudit({ organizationId: org.id, actorUserId, action: 'organization.created', entityType: 'Organization', entityId: org.id, after: { ...profile, subscription } }, tx)
    await writeAudit({ organizationId: org.id, actorUserId, action: 'subscription.created', entityType: 'Subscription', entityId: sub.id, after: subscription }, tx)
    const { temporaryPassword, member } = await addMember(org.id, actorUserId, { ...admin, role: 'TENANT_ADMIN' }, tx)
    return { organization: org, admin: member, temporaryPassword }
  })
  res.status(201).json(result)
}

export const getOrganization: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const id = orgParam(req)
  const org = await db.organization.findUnique({
    where: { id },
    include: {
      subscription: true,
      facilities: { orderBy: { name: 'asc' } },
      reportingPeriods: { orderBy: { startDate: 'desc' } },
      memberships: { include: { user: { select: { id: true, email: true, name: true, isActive: true, mfaEnabled: true } } }, orderBy: { user: { name: 'asc' } } },
      subscriptionEvents: { orderBy: { createdAt: 'desc' } },
      _count: { select: { activityRecords: true, emissionSources: true, evidence: true } },
    },
  })
  if (!org) throw new HttpError(404, 'Organisation not found')
  const audit = await db.auditLog.findMany({ where: { organizationId: id }, orderBy: { createdAt: 'desc' }, take: 100 })
  res.json({ ...describe(org), audit: await withActorNames(audit) })
}

export const updateOrganization: RequestHandler = async (req, res) => {
  const id = orgParam(req)
  const org = await getPrisma().$transaction(async (tx) => {
    const { subscription: _, ...before } = await findOrg(tx, id)
    const after = await tx.organization.update({ where: { id }, data: req.body })
    await writeAudit({ organizationId: id, actorUserId: req.auth!.userId, action: 'organization.profile_updated', entityType: 'Organization', entityId: id, before, after, reason: 'Platform administration' }, tx)
    return after
  })
  res.json(org)
}
export const platformUpdateProfileSchema = updateProfileSchema

export const setStatusSchema = z.object({
  status: z.enum(['ACTIVE', 'SUSPENDED']),
  reason: z.string().trim().max(500).optional(),
}).refine((s) => s.status === 'ACTIVE' || !!s.reason, { message: 'Give a reason for suspending', path: ['reason'] })

// Suspension blocks members on their next request (loadSession re-reads the status).
// No data is touched.
export const setOrganizationStatus: RequestHandler = async (req, res) => {
  const id = orgParam(req)
  const { status, reason } = req.body as z.infer<typeof setStatusSchema>
  const org = await getPrisma().$transaction(async (tx) => {
    const before = await findOrg(tx, id)
    if (before.status === status) throw new HttpError(409, `The organisation is already ${status.toLowerCase()}`)
    const after = await tx.organization.update({ where: { id }, data: { status, statusReason: status === 'SUSPENDED' ? reason : null } })
    await writeAudit({ organizationId: id, actorUserId: req.auth!.userId, action: status === 'SUSPENDED' ? 'organization.suspended' : 'organization.activated', entityType: 'Organization', entityId: id, before: { status: before.status }, after: { status }, reason }, tx)
    return after
  })
  res.json(org)
}

export const updateSubscriptionSchema = subscriptionInput.and(z.object({ reason: z.string().trim().max(500).optional() }))

export const updateSubscription: RequestHandler = async (req, res) => {
  const id = orgParam(req)
  const { reason, ...input } = req.body as z.infer<typeof updateSubscriptionSchema>
  const actorUserId = req.auth!.userId
  const sub = await getPrisma().$transaction(async (tx) => {
    const org = await findOrg(tx, id)
    const data = toSubData(input)
    const after = await tx.subscription.upsert({ where: { organizationId: id }, create: { organizationId: id, ...data }, update: data })
    await tx.subscriptionEvent.create({ data: { organizationId: id, actorUserId, ...data, reason } })
    await writeAudit({ organizationId: id, actorUserId, action: 'subscription.changed', entityType: 'Subscription', entityId: after.id, before: org.subscription, after, reason }, tx)
    return after
  })
  res.json({ ...sub, effectiveStatus: effectiveStatus(sub) })
}

const roleInput = z.enum(['TENANT_ADMIN', 'DATA_ENTRY', 'REVIEWER', 'VERIFIER'])
export const addOrgMemberSchema = adminInput.extend({ role: roleInput })

// Add a member with any role. A new email gets an account with a one-time password.
export const addOrgMember: RequestHandler = async (req, res) => {
  const id = orgParam(req)
  await findOrg(getPrisma(), id)
  res.status(201).json(await addMember(id, req.auth!.userId, req.body as z.infer<typeof addOrgMemberSchema>))
}

export const changeRoleSchema = z.object({ role: roleInput })

export const platformChangeRole: RequestHandler = async (req, res) => {
  await findOrg(getPrisma(), orgParam(req))
  res.json(await changeMemberRole(orgParam(req), req.auth!.userId, req.params.memberId as string, req.body.role))
}

// ---- Users / administrators ---------------------------------------------------

const userQuery = z.object({
  q: z.string().trim().max(100).optional(),
  type: z.enum(['SUPER_ADMIN', 'MEMBER']).optional(),
  state: z.enum(['ACTIVE', 'INACTIVE', 'PENDING']).optional(), // PENDING = has not completed first sign-in
  organizationId: z.uuid().optional(), // members of one organisation, with their role there
  page,
})

const userSummary = {
  id: true, email: true, name: true, isActive: true, mfaEnabled: true, platformRole: true, mustChangePassword: true, createdAt: true,
  _count: { select: { memberships: true } },
} as const

// Compact list; organisations are shown on the user's own page (getUser).
export const listUsers: RequestHandler = async (req, res) => {
  const q = userQuery.parse(req.query)
  const where: Prisma.UserWhereInput = {
    ...(q.q ? { OR: [{ email: contains(q.q) }, { name: contains(q.q) }] } : {}),
    ...(q.type === 'SUPER_ADMIN' ? { platformRole: 'SUPER_ADMIN' } : q.type === 'MEMBER' ? { platformRole: null } : {}),
    ...(q.state === 'ACTIVE' ? { isActive: true } : q.state === 'INACTIVE' ? { isActive: false } : q.state === 'PENDING' ? { mustChangePassword: true } : {}),
    ...(q.organizationId ? { memberships: { some: { organizationId: q.organizationId } } } : {}),
  }
  const select = q.organizationId
    ? { ...userSummary, memberships: { where: { organizationId: q.organizationId }, select: { id: true, role: true } } }
    : userSummary
  const db = getPrisma()
  const [rows, total] = await Promise.all([
    db.user.findMany({ where, select, orderBy: { name: 'asc' }, skip: (q.page - 1) * PAGE_SIZE, take: PAGE_SIZE }),
    db.user.count({ where }),
  ])
  // With an organisation selected, each row carries its membership there (id + role) for inline role changes.
  res.json(paged(rows.map(({ memberships, ...u }: { memberships?: Array<{ id: string; role: string }> } & typeof rows[number]) => ({ ...u, membership: memberships?.[0] ?? null })), total, q.page))
}

export const getUser: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const user = await db.user.findUnique({
    where: { id: req.params.id as string },
    select: {
      ...userSummary, lockedUntil: true,
      memberships: {
        select: { id: true, role: true, createdAt: true, organization: { select: { id: true, name: true, status: true } } },
        orderBy: { organization: { name: 'asc' } },
      },
    },
  })
  if (!user) throw new HttpError(404, 'User not found')
  const audit = await db.auditLog.findMany({
    where: { OR: [{ entityId: user.id }, { actorUserId: user.id }] },
    include: { organization: { select: { id: true, name: true } } },
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json({ ...user, audit: await withActorNames(audit) })
}

export const createSuperAdminSchema = adminInput

// New platform administrator, with a one-time password and a forced change at first sign-in.
export const createSuperAdmin: RequestHandler = async (req, res) => {
  const { email, name } = req.body as z.infer<typeof adminInput>
  const password = randomBytes(12).toString('base64url')
  const user = await getPrisma().$transaction(async (tx) => {
    if (await tx.user.findUnique({ where: { email } })) throw new HttpError(409, 'An account with this email already exists')
    const u = await tx.user.create({
      data: { email, name, passwordHash: await hashPassword(password), platformRole: 'SUPER_ADMIN', mustChangePassword: true },
      select: { id: true, email: true, name: true },
    })
    await writeAudit({ actorUserId: req.auth!.userId, action: 'platform.admin_created', entityType: 'User', entityId: u.id, after: { email } }, tx)
    return u
  })
  res.status(201).json({ user, temporaryPassword: password })
}

export const updateUserSchema = z.object({
  isActive: z.boolean().optional(),
  platformRole: z.enum(['SUPER_ADMIN']).nullable().optional(),
})

export const updateUser: RequestHandler = async (req, res) => {
  const id = req.params.id as string
  const data = req.body as z.infer<typeof updateUserSchema>
  const actorUserId = req.auth!.userId
  const user = await getPrisma().$transaction(async (tx) => {
    const before = await tx.user.findUnique({ where: { id }, include: { _count: { select: { memberships: true } } } })
    if (!before) throw new HttpError(404, 'User not found')
    const losesAdmin = before.platformRole === 'SUPER_ADMIN' && (data.platformRole === null || data.isActive === false)
    if (id === actorUserId && losesAdmin) throw new HttpError(409, 'You cannot deactivate or demote your own account')
    if (losesAdmin && (await tx.user.count({ where: { platformRole: 'SUPER_ADMIN', isActive: true } })) <= 1) {
      throw new HttpError(409, 'The platform must keep at least one active Super Admin')
    }
    if (data.platformRole === 'SUPER_ADMIN' && before._count.memberships > 0) {
      throw new HttpError(409, 'Organisation members cannot be made platform administrators. Use a separate account.')
    }
    const after = await tx.user.update({ where: { id }, data, select: { id: true, email: true, name: true, isActive: true, platformRole: true } })
    if (data.isActive === false) await tx.session.deleteMany({ where: { userId: id } }) // signed out everywhere
    const action = data.isActive === false ? 'user.deactivated' : data.isActive === true ? 'user.activated' : data.platformRole ? 'platform.admin_granted' : 'platform.admin_revoked'
    await writeAudit({ actorUserId, action, entityType: 'User', entityId: id, before: { isActive: before.isActive, platformRole: before.platformRole }, after: { isActive: after.isActive, platformRole: after.platformRole } }, tx)
    return after
  })
  res.json(user)
}

// ---- Audit trail ----------------------------------------------------------------

const auditQuery = z.object({
  organizationId: z.uuid().optional(),
  action: z.string().trim().max(100).optional(),
  platformOnly: z.literal('true').optional(),
  before: z.uuid().optional(), // cursor: id of the last row already shown
})

// Newest first, PAGE_SIZE at a time. Cursor (keyset) paging rather than page numbers:
// the audit log grows without limit, and OFFSET/COUNT get slow over millions of rows.
export const listAudit: RequestHandler = async (req, res) => {
  const q = auditQuery.parse(req.query)
  const rows = await getPrisma().auditLog.findMany({
    where: {
      ...(q.platformOnly ? { organizationId: null } : { organizationId: q.organizationId }),
      ...(q.action ? { action: { contains: q.action } } : {}),
    },
    include: { organization: { select: { id: true, name: true } } },
    orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
    take: PAGE_SIZE + 1,
    ...(q.before ? { cursor: { id: q.before }, skip: 1 } : {}),
  })
  const more = rows.length > PAGE_SIZE
  const page = rows.slice(0, PAGE_SIZE)
  res.json({ rows: await withActorNames(page), nextCursor: more ? page[page.length - 1].id : null })
}

// TC-ARC-006 section 5: the platform team cannot see what a tenant's factors hold. Their audit events keep
// who did what and when, without the factor's content (value, source, basis, evidence, reasons).
const TENANT_PRIVATE = new Set(['EmissionFactor'])
async function withActorNames<T extends { actorUserId: string | null; organizationId?: string | null; entityType?: string; before?: unknown; after?: unknown; reason?: string | null }>(rows: T[]) {
  const ids = [...new Set(rows.map((r) => r.actorUserId).filter((x): x is string => !!x))]
  const users = await getPrisma().user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } })
  return rows.map((r) => ({
    ...r,
    ...(r.organizationId && r.entityType && TENANT_PRIVATE.has(r.entityType) ? { before: null, after: null, reason: null, redacted: true } : {}),
    actor: users.find((u) => u.id === r.actorUserId) ?? null,
  }))
}

export const resetPasswordSchema = z.object({ resetMfa: z.boolean().default(false) })

export const resetUserPassword: RequestHandler = async (req, res) => {
  const id = req.params.id as string
  if (id === req.auth!.userId) throw new HttpError(409, 'Change your own password in Account Settings')
  const temporaryPassword = await getPrisma().$transaction(async (tx) => {
    if (!(await tx.user.findUnique({ where: { id } }))) throw new HttpError(404, 'User not found')
    return issueTemporaryPassword(tx, id, { actorUserId: req.auth!.userId }, req.body.resetMfa)
  })
  res.json({ temporaryPassword })
}
