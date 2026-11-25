import type { RequestHandler } from 'express'
import { z } from 'zod'
import { devShortcuts, env } from '../config/env.js'
import { DUMMY_PASSWORD_HASH, hashPassword, matchTotp, newToken, newTotpSecret, openSecret, otpauthUrl, sealSecret, verifyPassword } from '../auth/crypto.js'
import { permissionsFor } from '../auth/permissions.js'
import { clearSessionCookie, promoteSession, readToken, startSession } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { isSandboxAccount } from './test-switch.controller.js'
import { orgAccess } from '../services/access.js'
import { writeAudit } from '../services/audit.js'

export const MAX_FAILED_LOGINS = 5
export const LOCKOUT_MS = 15 * 60 * 1000
export const MAX_MFA_ATTEMPTS = 5

export const loginSchema = z.object({
  email: z.string().trim().pipe(z.email('Enter a valid email')).transform((e) => e.toLowerCase()),
  password: z.string().min(1).max(200),
})

export const login: RequestHandler = async (req, res) => {
  const { email, password } = req.body as z.infer<typeof loginSchema>
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { email } })

  if (!user || !user.isActive) {
    await verifyPassword(password, DUMMY_PASSWORD_HASH) // equalise timing
    throw new HttpError(401, 'Invalid email or password')
  }
  if (user.lockedUntil && user.lockedUntil > new Date()) {
    throw new HttpError(429, 'Too many failed attempts. Try again later.')
  }
  if (!(await verifyPassword(password, user.passwordHash))) {
    const failed = user.failedLoginCount + 1
    const lock = failed >= MAX_FAILED_LOGINS
    await db.user.update({
      where: { id: user.id },
      data: lock ? { failedLoginCount: 0, lockedUntil: new Date(Date.now() + LOCKOUT_MS) } : { failedLoginCount: failed },
    })
    await writeAudit({ actorUserId: user.id, action: lock ? 'auth.locked' : 'auth.login_failed', entityType: 'User', entityId: user.id })
    throw new HttpError(401, 'Invalid email or password')
  }

   await db.user.update({ where: { id: user.id }, data: { failedLoginCount: 0, lockedUntil: null } })
  const { token, sessionId } = await startSession(res, user.id)
  if (devShortcuts || isSandboxAccount(user.email) || !env.MFA_ENABLED) {
    await promoteSession(res, sessionId, token)
    res.json({ mfa: null })
    return
  }
  res.json({ mfa: user.mfaEnabled ? 'verify' : 'setup' })

}

// First sign-in only: issue an authenticator secret. Not available once MFA is enabled.
export const mfaSetup: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const user = await db.user.findUniqueOrThrow({ where: { id: req.auth!.userId } })
  if (user.mfaEnabled) throw new HttpError(409, 'Two-step verification is already set up')
  // Reuse a pending secret: a reload or a repeated request must not invalidate the key the
  // user has already added to their app. Only the password-verified user reaches this.
  const secret = user.mfaSecret ? openSecret(user.mfaSecret) : newTotpSecret()
  if (!user.mfaSecret) await db.user.update({ where: { id: user.id }, data: { mfaSecret: sealSecret(secret) } })
  res.json({ secret, otpauthUrl: otpauthUrl(secret, user.email) })
}

export const mfaVerifySchema = z.object({ code: z.string().trim().regex(/^\d{6}$/, 'Enter the 6-digit code') })

export const mfaVerify: RequestHandler = async (req, res) => {
  const { code } = req.body as z.infer<typeof mfaVerifySchema>
  const auth = req.auth!
  if (auth.mfaVerified) return void res.json({ ok: true })

  const db = getPrisma()
  const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId } })
  if (!user.mfaSecret) throw new HttpError(400, 'Set up two-step verification first')

  const secret = openSecret(user.mfaSecret)
  const step = matchTotp(secret, code)
  if (step === null || (user.mfaLastStep !== null && step <= user.mfaLastStep)) {
    const session = await db.session.update({ where: { id: auth.sessionId }, data: { mfaFailedCount: { increment: 1 } } })
    if (session.mfaFailedCount >= MAX_MFA_ATTEMPTS) {
      await db.session.delete({ where: { id: auth.sessionId } })
      clearSessionCookie(res)
      throw new HttpError(401, 'Too many incorrect codes. Sign in again.')
    }
    throw new HttpError(401, 'Incorrect or expired code')
  }

  // Re-sealing also encrypts a secret stored before encryption was set up.
  await db.user.update({ where: { id: user.id }, data: { mfaEnabled: true, mfaLastStep: step, mfaSecret: sealSecret(secret) } })
  if (!user.mfaEnabled) {
    await writeAudit({ actorUserId: user.id, action: 'auth.mfa_enabled', entityType: 'User', entityId: user.id })
  }
  await promoteSession(res, auth.sessionId, readToken(req.headers.cookie)!)
  await writeAudit({ actorUserId: user.id, action: 'auth.login', entityType: 'User', entityId: user.id })
  res.json({ ok: true })
}

export const logout: RequestHandler = async (req, res) => {
  if (req.auth) await getPrisma().session.deleteMany({ where: { id: req.auth.sessionId } })
  clearSessionCookie(res)
  res.status(204).end()
}

export const me: RequestHandler = async (req, res) => {
  const auth = req.auth!
  const db = getPrisma()
  const user = await db.user.findUniqueOrThrow({
    where: { id: auth.userId },
    select: { id: true, email: true, name: true, mfaEnabled: true, platformRole: true, mustChangePassword: true },
  })
  const organization = auth.organizationId
    ? await db.organization.findUnique({ where: { id: auth.organizationId }, select: { id: true, name: true } })
    : null
  res.json({
    user,
    mfaVerified: auth.mfaVerified,
    organization,
    role: auth.role,
    permissions: auth.role ? permissionsFor(auth.role) : [],
    access: auth.organizationId ? auth.access : null,
    accessReason: auth.organizationId ? auth.accessReason : null,
  })
}

export const listMyOrganizations: RequestHandler = async (req, res) => {
  const memberships = await getPrisma().membership.findMany({
    where: { userId: req.auth!.userId },
    include: { organization: { select: { id: true, name: true, status: true, subscription: true } } },
    orderBy: { organization: { name: 'asc' } },
  })
  res.json(memberships.map(({ organization: { subscription, ...o }, role }) => ({ id: o.id, name: o.name, role, ...orgAccess(o, subscription) })))
}

export const selectOrganizationSchema = z.object({ organizationId: z.uuid() })

export const selectOrganization: RequestHandler = async (req, res) => {
  const { organizationId } = req.body as z.infer<typeof selectOrganizationSchema>
  const auth = req.auth!
  const db = getPrisma()
  const membership = await db.membership.findUnique({
    where: { userId_organizationId: { userId: auth.userId, organizationId } },
    include: { organization: { select: { status: true, subscription: true } } },
  })
  // Same response whether the org does not exist or the user is not a member.
  if (!membership) throw new HttpError(403, 'You do not have access to this organisation')
  const { access, reason } = orgAccess(membership.organization, membership.organization.subscription)
  if (access === 'none') throw new HttpError(403, reason!)
  await db.session.update({ where: { id: auth.sessionId }, data: { activeOrganizationId: organizationId } })
  await writeAudit({ organizationId, actorUserId: auth.userId, action: 'auth.organization_selected', entityType: 'Organization', entityId: organizationId })
  res.json({ id: organizationId, role: membership.role, permissions: permissionsFor(membership.role) })
}

export const PASSWORD_MIN = 10

export const changePasswordSchema = z.object({
  currentPassword: z.string().max(200).optional(), // not needed for the forced first change
  newPassword: z.string().min(PASSWORD_MIN, `Use at least ${PASSWORD_MIN} characters`).max(200),
})

// Used for the forced first-login change and from Account Settings. The forced change skips the
// current password: the user proved it moments ago at sign-in (with two-step) in this same session.
// Ends every other session of the user; this one stays signed in.
export const changePassword: RequestHandler = async (req, res) => {
  const { currentPassword, newPassword } = req.body as z.infer<typeof changePasswordSchema>
  const auth = req.auth!
  const db = getPrisma()
  const user = await db.user.findUniqueOrThrow({ where: { id: auth.userId } })
  if (!user.mustChangePassword && !(await verifyPassword(currentPassword ?? '', user.passwordHash))) {
    await writeAudit({ actorUserId: user.id, action: 'auth.password_change_failed', entityType: 'User', entityId: user.id })
    throw new HttpError(400, 'Current password is incorrect')
  }
  if (await verifyPassword(newPassword, user.passwordHash)) throw new HttpError(400, 'Choose a password different from the current one')
  if (newPassword.toLowerCase().includes(user.email.split('@')[0].toLowerCase())) throw new HttpError(400, 'The password must not contain your email name')
  const passwordHash = await hashPassword(newPassword)
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false } })
    await tx.session.deleteMany({ where: { userId: user.id, id: { not: auth.sessionId } } })
    await writeAudit({ actorUserId: user.id, action: 'auth.password_changed', entityType: 'User', entityId: user.id }, tx)
  })
  res.json({ ok: true })
}

// DEV ONLY — issues a new one-time password for any email without auth or email sending.
// Blocked in production.
export const devResetPasswordSchema = z.object({ email: z.string().trim().email() })
export const devResetPassword: RequestHandler = async (req, res) => {
  if (!devShortcuts) throw new HttpError(404, 'Route not found')
  const { email } = req.body as z.infer<typeof devResetPasswordSchema>
  const db = getPrisma()
  const user = await db.user.findUnique({ where: { email: email.toLowerCase() } })
  if (!user) throw new HttpError(404, 'No account with that email')
  const password = newToken()
  const passwordHash = await hashPassword(password)
  await db.$transaction(async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: true, failedLoginCount: 0, lockedUntil: null } })
    await tx.session.deleteMany({ where: { userId: user.id } })
  })
  res.json({ temporaryPassword: password })
}

