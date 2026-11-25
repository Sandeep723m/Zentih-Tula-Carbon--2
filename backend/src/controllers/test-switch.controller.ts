// Password-less quick-switch for the Zenith Testing sandbox ONLY. Lets the team flip between the four
// role logins of the "Zenith Testing" org while testing on a deployed site. It exists only while
// TEST_SWITCH=true, and it refuses any account that is not one of the four sandbox roles: a target must
// have no platform role and belong to exactly the Zenith Testing org, so this can never reach a real
// customer org or a Super Admin. Every switch is written to the audit log like any other sign-in.
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { promoteSession, startSession } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { env } from '../config/env.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'

export const ZENITH_ORG_NAME = 'Zenith Testing'
export const ZENITH_SUPER_EMAIL = 'superadmin@zenithtesting.in'

// The only accounts the switch may sign in as. Role order is the display order of the buttons.
// 'super' is the Zenith sandbox Super Admin (platform-wide), the only platform-role account allowed.
export const ZENITH_ROLES = [
  { id: 'tenant', label: 'Tenant Admin', email: 'tenant@zenithtesting.in', role: 'TENANT_ADMIN' },
  { id: 'entry', label: 'Data Entry', email: 'dataentry@zenithtesting.in', role: 'DATA_ENTRY' },
  { id: 'reviewer', label: 'Reviewer', email: 'reviewer@zenithtesting.in', role: 'REVIEWER' },
  { id: 'verifier', label: 'Verifier', email: 'verifier@zenithtesting.in', role: 'VERIFIER' },
  { id: 'super', label: 'Super Admin', email: ZENITH_SUPER_EMAIL, role: 'SUPER_ADMIN' },
] as const
type RoleId = (typeof ZENITH_ROLES)[number]['id']

// Two-step is skipped for these sandbox logins while TEST_SWITCH is on; no other account is affected.
const SANDBOX_EMAILS: string[] = ZENITH_ROLES.map((a) => a.email)
export const isSandboxAccount = (email: string) => env.TEST_SWITCH && SANDBOX_EMAILS.includes(email.toLowerCase())

export const testSwitchInfo: RequestHandler = (_req, res) => {
  res.json(env.TEST_SWITCH ? { enabled: true, accounts: ZENITH_ROLES.map((a) => ({ id: a.id, label: a.label })) } : { enabled: false, accounts: [] })
}

export const testSwitchSchema = z.object({ account: z.enum(ZENITH_ROLES.map((a) => a.id) as [RoleId, ...RoleId[]]) })

export const testSwitchLogin: RequestHandler = async (req, res) => {
  if (!env.TEST_SWITCH) throw new HttpError(404, 'Route not found')
  const { account } = req.body as z.infer<typeof testSwitchSchema>
  const target = ZENITH_ROLES.find((a) => a.id === account)!
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { email: target.email }, include: { memberships: { include: { organization: { select: { name: true } } } } } })
  if (!user || !user.isActive) throw new HttpError(503, 'Zenith test accounts are not set up. Run: npm run zenith:seed')

  // Safety gate: never sign in as anything but a sandboxed Zenith role. A platform admin, or an account
  // with access to any other org, is refused even if its email somehow matched the list above.
  const isSuper = target.email === ZENITH_SUPER_EMAIL
  const onlyZenith = user.platformRole === null && user.memberships.length === 1 && user.memberships[0].organization.name === ZENITH_ORG_NAME
  const matchesSuper = user.platformRole === 'SUPER_ADMIN' && user.email.toLowerCase() === ZENITH_SUPER_EMAIL
  if (!(isSuper ? matchesSuper : onlyZenith)) throw new HttpError(403, 'That account is not a Zenith Testing sandbox account.')

  const { token, sessionId } = await startSession(res, user.id)
  await promoteSession(res, sessionId, token)
  // Role logins have one sandbox org: select it so the switch lands straight in. Super Admin has none.
  const orgId = user.memberships[0]?.organizationId ?? null
  if (orgId) await db.session.update({ where: { id: sessionId }, data: { activeOrganizationId: orgId } })
  await writeAudit({ organizationId: orgId ?? undefined, actorUserId: user.id, action: 'auth.test_switch', entityType: 'User', entityId: user.id })
  res.json({ ok: true })
}
