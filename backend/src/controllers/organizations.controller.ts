import type { RequestHandler } from 'express'
import { z } from 'zod'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { optionalText } from '../middleware/validate.js'
import { writeAudit } from '../services/audit.js'

const select = {
  id: true, name: true, legalName: true, country: true, industry: true, address: true,
  timezone: true, fiscalYearStartMonth: true, requireEvidenceOnSubmit: true, qualityAnomalyPercent: true, qualityMinHistory: true, createdAt: true,
} as const

export const getCurrentOrganization: RequestHandler = async (req, res) => {
  res.json(await getPrisma().organization.findUniqueOrThrow({ where: { id: orgId(req) }, select }))
}

export const updateProfileSchema = z.object({
  name: z.string().trim().min(1).max(200),
  legalName: optionalText(200),
  country: optionalText(100),
  industry: optionalText(100),
  address: optionalText(500),
}).partial()

// Accepts aliases such as Asia/Kolkata, which Intl.supportedValuesOf omits.
function isTimeZone(tz: string) {
  try { new Intl.DateTimeFormat('en', { timeZone: tz }); return true } catch { return false }
}

export const updateSettingsSchema = z.object({
  timezone: z.string().max(100).refine(isTimeZone, 'Unknown time zone'),
  fiscalYearStartMonth: z.number().int().min(1).max(12),
  requireEvidenceOnSubmit: z.boolean(),
  qualityAnomalyPercent: z.number().int().min(5).max(1000),
  qualityMinHistory: z.number().int().min(1).max(12),
}).partial()

// Profile and settings are both columns of Organization; they differ only in
// which fields the request may change (enforced by the route's schema).
const updateOrganization = (action: string): RequestHandler => async (req, res) => {
  const id = orgId(req)
  const updated = await getPrisma().$transaction(async (tx) => {
    const before = await tx.organization.findUniqueOrThrow({ where: { id }, select })
    const after = await tx.organization.update({ where: { id }, data: req.body, select })
    await writeAudit({ organizationId: id, actorUserId: req.auth!.userId, action, entityType: 'Organization', entityId: id, before, after }, tx)
    return after
  })
  res.json(updated)
}

export const updateProfile = updateOrganization('organization.profile_updated')
export const updateSettings = updateOrganization('organization.settings_updated')
