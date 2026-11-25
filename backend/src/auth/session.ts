import type { CookieOptions, RequestHandler, Response } from 'express'
import type { PlatformRole, Role } from '../../generated/prisma/client.js'
import { getPrisma } from '../config/database.js'
import { env } from '../config/env.js'
import { HttpError } from '../middleware/errorHandler.js'
import { orgAccess, type OrgAccess } from '../services/access.js'
import { hashToken, newToken } from './crypto.js'
import { can, type Permission } from './permissions.js'

// __Host- (production, HTTPS): the browser only accepts it Secure, host-only and on path /, so no subdomain can set or overwrite it.
export const SESSION_COOKIE = env.NODE_ENV === 'production' ? '__Host-tula_carbon_session' : 'tula_carbon_session'
export const PRE_MFA_TTL_MS = 10 * 60 * 1000 // password checked, code not yet entered
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000 // ponytail: fixed 12 h session, add sliding renewal if users complain

export interface AuthContext {
  sessionId: string
  userId: string
  mfaVerified: boolean
  organizationId: string | null
  role: Role | null
  access: OrgAccess // for the active organisation; 'none' when no organisation is selected
  accessReason: string | null
  platformRole: PlatformRole | null
  mustChangePassword: boolean
}

declare global {
  namespace Express {
    interface Request {
      auth?: AuthContext
    }
  }
}

const cookieOptions = (maxAge: number): CookieOptions => ({
  httpOnly: true,
  sameSite: 'lax',
  secure: env.NODE_ENV === 'production',
  path: '/',
  maxAge,
})

export async function startSession(res: Response, userId: string) {
  const token = newToken()
  const session = await getPrisma().session.create({
    data: { tokenHash: hashToken(token), userId, expiresAt: new Date(Date.now() + PRE_MFA_TTL_MS) },
  })
  res.cookie(SESSION_COOKIE, token, cookieOptions(PRE_MFA_TTL_MS))
  return { token, sessionId: session.id }
}

// Called once the second factor is verified: extends the session to its full lifetime.
export async function promoteSession(res: Response, sessionId: string, token: string) {
  await getPrisma().session.update({
    where: { id: sessionId },
    data: { mfaVerified: true, mfaFailedCount: 0, expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  })
  res.cookie(SESSION_COOKIE, token, cookieOptions(SESSION_TTL_MS))
}

export const clearSessionCookie = (res: Response) => res.clearCookie(SESSION_COOKIE, { path: '/' })

export function readToken(cookieHeader: string | undefined): string | null {
  for (const part of (cookieHeader ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=')
    if (k === SESSION_COOKIE) return decodeURIComponent(v.join('='))
  }
  return null
}

// Loads the session (if any) onto req.auth. Never rejects on its own.
export const loadSession: RequestHandler = async (req, _res, next) => {
  const token = readToken(req.headers.cookie)
  if (!token) return next()
  const session = await getPrisma().session.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { select: { isActive: true, platformRole: true, mustChangePassword: true } } },
  })
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return next()

  // Membership, organisation status and subscription are re-read on every request, so
  // removal, suspension or expiry takes effect immediately for existing sessions.
  let role: Role | null = null
  let access: { access: OrgAccess; reason: string | null } = { access: 'none', reason: null }
  if (session.activeOrganizationId) {
    const m = await getPrisma().membership.findUnique({
      where: { userId_organizationId: { userId: session.userId, organizationId: session.activeOrganizationId } },
      include: { organization: { select: { status: true, subscription: true } } },
    })
    role = m?.role ?? null // membership removed since selection → no org access
    if (m) access = orgAccess(m.organization, m.organization.subscription)
  }
  req.auth = {
    sessionId: session.id,
    userId: session.userId,
    mfaVerified: session.mfaVerified,
    organizationId: role ? session.activeOrganizationId : null,
    role,
    access: access.access,
    accessReason: access.reason,
    platformRole: session.user.platformRole,
    mustChangePassword: session.user.mustChangePassword,
  }
  next()
}

// Password accepted; second factor may still be pending.
export const requirePasswordStep: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, 'Not signed in')
  next()
}

// Both factors done, but a forced password change may still be pending. Only for the change itself.
export const requireSignedIn: RequestHandler = (req, _res, next) => {
  if (!req.auth) throw new HttpError(401, 'Not signed in')
  if (!req.auth.mfaVerified) throw new HttpError(401, 'Two-step verification required')
  next()
}

export const requireAuth: RequestHandler = (req, res, next) => {
  requireSignedIn(req, res, () => {
    if (req.auth!.mustChangePassword) throw new HttpError(403, 'You must change your password first')
    next()
  })
}

// Platform administration: the role is stored on the user row, never inferred from email.
export const requireSuperAdmin: RequestHandler[] = [
  requireAuth,
  (req, _res, next) => {
    if (req.auth!.platformRole !== 'SUPER_ADMIN') throw new HttpError(403, 'Platform administrators only')
    next()
  },
]

// Requires a fully signed-in user with an organisation selected and the given permission in it.
export const requirePermission = (permission: Permission): RequestHandler[] => [
  requireAuth,
  (req, _res, next) => {
    const { organizationId, role } = req.auth!
    if (!organizationId || !role) throw new HttpError(403, 'Select an organisation first')
    if (!can(role, permission)) throw new HttpError(403, 'You do not have permission for this action')
    const { access, accessReason } = req.auth!
    if (access === 'none') throw new HttpError(403, accessReason ?? 'This organisation is not available')
    if (access === 'read' && req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(403, accessReason ?? 'This organisation is read-only')
    next()
  },
]

// For handlers behind requirePermission: the active organisation id, always non-null.
export const orgId = (req: { auth?: AuthContext }) => req.auth!.organizationId!
