import type { RequestHandler } from 'express'
import { z } from 'zod'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { optionalText } from '../middleware/validate.js'
import { writeAudit } from '../services/audit.js'

export const createFacilitySchema = z.object({
  name: z.string().trim().min(1).max(200),
  code: z.string().trim().min(1).max(50),
  country: optionalText(100),
  city: optionalText(100),
  address: optionalText(500),
  isActive: z.boolean().default(true),
})
export const updateFacilitySchema = createFacilitySchema.partial()

export const listFacilities: RequestHandler = async (req, res) => {
  res.json(await getPrisma().facility.findMany({ where: { organizationId: orgId(req) }, orderBy: { name: 'asc' } }))
}

export const createFacility: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const facility = await getPrisma().$transaction(async (tx) => {
    const f = await tx.facility.create({ data: { ...req.body, organizationId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'facility.created', entityType: 'Facility', entityId: f.id, after: f }, tx)
    return f
  })
  res.status(201).json(facility)
}

export const updateFacility: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const facility = await getPrisma().$transaction(async (tx) => {
    const before = await tx.facility.findFirst({ where: { id: req.params.id as string, organizationId } })
    if (!before) throw new HttpError(404, 'Facility not found')
    const after = await tx.facility.update({ where: { id: before.id }, data: req.body })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'facility.updated', entityType: 'Facility', entityId: before.id, before, after }, tx)
    return after
  })
  res.json(facility)
}
