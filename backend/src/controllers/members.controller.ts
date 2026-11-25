import { randomBytes } from 'node:crypto'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma, Role } from '../../generated/prisma/client.js'
import { hashPassword } from '../auth/crypto.js'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'

const role = z.enum(['TENANT_ADMIN', 'DATA_ENTRY', 'REVIEWER', 'VERIFIER'])

export const inviteMemberSchema = z.object({
  email: z.email().transform((e) => e.toLowerCase()),
  name: z.string().trim().min(1).max(200),
  role,
})
export const updateMemberSchema = z.object({ role })

const include = { user: { select: { id: true, email: true, name: true, isActive: true, mfaEnabled: true, mustChangePassword: true } } } as const

async function findMember(tx: Prisma.TransactionClient, organizationId: string, id: string) {
  const m = await tx.membership.findFirst({ where: { id, organizationId }, include })
  if (!m) throw new HttpError(404, 'Member not found')
  return m
}

// The organisation must always keep at least one Tenant Admin, or nobody could manage it.
// ponytail: count-then-write in one transaction; two admins demoting each other at the same
// instant could both pass. Lock the admin rows (SELECT … FOR UPDATE) if that becomes real.
async function assertNotLastAdmin(tx: Prisma.TransactionClient, organizationId: string) {
  const admins = await tx.membership.count({ where: { organizationId, role: 'TENANT_ADMIN' } })
  if (admins <= 1) throw new HttpError(409, 'The organisation must keep at least one Tenant Admin')
}

export const listMembers: RequestHandler = async (req, res) => {
  res.json(await getPrisma().membership.findMany({ where: { organizationId: orgId(req) }, include, orderBy: { user: { name: 'asc' } } }))
}

// New people get an account with a one-time password, shown once to the admin to pass on
// (there is no email service yet). Existing accounts are simply added to this organisation.
// Shared by tenant admins (their own organisation) and Super Admins (any organisation).
// Pass `tx` to make the addition part of a larger transaction, e.g. creating the organisation.
export async function addMember(organizationId: string, actorUserId: string, input: z.infer<typeof inviteMemberSchema>, tx?: Prisma.TransactionClient) {
  const { email, name, role } = input
  const password = randomBytes(12).toString('base64url')
  const passwordHash = await hashPassword(password)
  const run = async (tx: Prisma.TransactionClient) => {
    const existing = await tx.user.findUnique({ where: { email } })
    if (existing && (await tx.membership.findFirst({ where: { userId: existing.id, organizationId } }))) {
      throw new HttpError(409, 'This person is already a member')
    }
    if (existing?.platformRole) throw new HttpError(409, 'Platform administrator accounts cannot join organisations')
    const user = existing ?? (await tx.user.create({ data: { email, name, passwordHash, mustChangePassword: true } }))
    const member = await tx.membership.create({ data: { userId: user.id, organizationId, role }, include })
    await writeAudit({ organizationId, actorUserId, action: 'member.added', entityType: 'Membership', entityId: member.id, after: { email, role } }, tx)
    return { member, temporaryPassword: existing ? null : password }
  }
  return tx ? run(tx) : getPrisma().$transaction(run)
}

export async function changeMemberRole(organizationId: string, actorUserId: string, memberId: string, role: Role) {
  return getPrisma().$transaction(async (tx) => {
    const before = await findMember(tx, organizationId, memberId)
    if (before.role === 'TENANT_ADMIN' && role !== 'TENANT_ADMIN') await assertNotLastAdmin(tx, organizationId)
    const after = await tx.membership.update({ where: { id: before.id }, data: { role }, include })
    await writeAudit({ organizationId, actorUserId, action: 'member.role_changed', entityType: 'Membership', entityId: before.id, before: { email: before.user.email, role: before.role }, after: { email: before.user.email, role } }, tx)
    return after
  })
}

export const inviteMember: RequestHandler = async (req, res) => {
  res.status(201).json(await addMember(orgId(req), req.auth!.userId, req.body))
}

export const updateMember: RequestHandler = async (req, res) => {
  res.json(await changeMemberRole(orgId(req), req.auth!.userId, req.params.id as string, req.body.role))
}

// Access ends on the member's next request: loadSession re-checks membership every time.
export const removeMember: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  await getPrisma().$transaction(async (tx) => {
    const m = await findMember(tx, organizationId, req.params.id as string)
    if (m.role === 'TENANT_ADMIN') await assertNotLastAdmin(tx, organizationId)
    await tx.membership.delete({ where: { id: m.id } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'member.removed', entityType: 'Membership', entityId: m.id, before: { email: m.user.email, role: m.role } }, tx)
  })
  res.status(204).end()
}

// Replaces the user's password with a new one-time password (returned once, never stored in
// plain text), forces a change at next sign-in and signs them out everywhere. With resetMfa the
// authenticator is cleared too, so they set it up again (lost phone).
export async function issueTemporaryPassword(tx: Prisma.TransactionClient, userId: string, audit: { actorUserId: string; organizationId?: string }, resetMfa = false) {
  const password = randomBytes(12).toString('base64url')
  await tx.user.update({
    where: { id: userId },
    data: {
      passwordHash: await hashPassword(password), mustChangePassword: true, failedLoginCount: 0, lockedUntil: null,
      ...(resetMfa ? { mfaEnabled: false, mfaSecret: null, mfaLastStep: null } : {}),
    },
  })
  await tx.session.deleteMany({ where: { userId } })
  await writeAudit({ ...audit, action: resetMfa ? 'user.password_and_mfa_reset' : 'user.password_reset', entityType: 'User', entityId: userId }, tx)
  return password
}

// Tenant Admins may only re-issue a one-time password for someone who has never signed in
// and belongs to no other organisation; anything else could take over a working account.
export const resetMemberPassword: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const temporaryPassword = await getPrisma().$transaction(async (tx) => {
    const m = await findMember(tx, organizationId, req.params.id as string)
    const otherOrgs = await tx.membership.count({ where: { userId: m.userId, organizationId: { not: organizationId } } })
    if (!m.user.mustChangePassword || otherOrgs > 0) {
      throw new HttpError(409, 'This person has already signed in. They can change their password in Account Settings, or ask Tula Carbon support to reset it.')
    }
    return issueTemporaryPassword(tx, m.userId, { actorUserId: req.auth!.userId, organizationId })
  })
  res.json({ temporaryPassword })
}
