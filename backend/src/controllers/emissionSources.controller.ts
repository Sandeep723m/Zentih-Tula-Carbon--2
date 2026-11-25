import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma, SourceCategory } from '../../generated/prisma/client.js'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { optionalText } from '../middleware/validate.js'
import { writeAudit } from '../services/audit.js'

export const SCOPE_OF: Record<SourceCategory, 1 | 2> = {
  FUEL_COMBUSTION: 1,
  FUGITIVE_GAS: 1,
  PURCHASED_ELECTRICITY: 2,
  PURCHASED_ENERGY: 2,
  PROCESS: 1,
  REMOVAL: 1, // a removal line beside Scope 1, never netted against it
}

export const createSourceSchema = z.object({
  facilityId: z.uuid(),
  name: z.string().trim().min(1).max(200),
  category: z.enum(['FUEL_COMBUSTION', 'FUGITIVE_GAS', 'PURCHASED_ELECTRICITY', 'PURCHASED_ENERGY', 'PROCESS', 'REMOVAL']),
  material: optionalText(100),
  activityCode: z.string().trim().max(40).nullish().transform((v) => v || null), // tab 02 activity (fuel, gas, grid) the engine calculates it as
  defaultUnit: optionalText(20),
  isActive: z.boolean().default(true),
})
export const updateSourceSchema = createSourceSchema.partial()

const include = { facility: { select: { id: true, name: true, code: true } }, activityType: { select: { code: true, name: true, formulaCode: true } } } as const

// The activity must measure this kind of source (diesel for fuel combustion, R-410A for fugitive gas…).
async function assertActivityFits(tx: Prisma.TransactionClient, category: SourceCategory, activityCode: string | null | undefined) {
  if (!activityCode) return
  const a = await tx.activityType.findUnique({ where: { code: activityCode } })
  if (!a || a.sourceCategory !== category) throw new HttpError(400, 'The selected fuel, gas or activity does not belong to this source category')
}
const withScope = <T extends { category: SourceCategory }>(s: T) => ({ ...s, scope: SCOPE_OF[s.category] })

// A source may only point at a facility of the same organisation.
async function assertFacilityInOrg(tx: Prisma.TransactionClient, organizationId: string, facilityId: string) {
  const f = await tx.facility.findFirst({ where: { id: facilityId, organizationId } })
  if (!f) throw new HttpError(400, 'Facility not found')
}

export const listSources: RequestHandler = async (req, res) => {
  const facilityId = typeof req.query.facilityId === 'string' ? req.query.facilityId : undefined
  const sources = await getPrisma().emissionSource.findMany({
    where: { organizationId: orgId(req), ...(facilityId ? { facilityId } : {}) },
    include,
    orderBy: [{ facility: { name: 'asc' } }, { name: 'asc' }],
  })
  res.json(sources.map(withScope))
}

export const createSource: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const data = req.body as z.infer<typeof createSourceSchema>
  const source = await getPrisma().$transaction(async (tx) => {
    await assertFacilityInOrg(tx, organizationId, data.facilityId)
    await assertActivityFits(tx, data.category, data.activityCode)
    const s = await tx.emissionSource.create({ data: { ...data, organizationId }, include })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'source.created', entityType: 'EmissionSource', entityId: s.id, after: s }, tx)
    return s
  })
  res.status(201).json(withScope(source))
}

export const updateSource: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const data = req.body as z.infer<typeof updateSourceSchema>
  const source = await getPrisma().$transaction(async (tx) => {
    const before = await tx.emissionSource.findFirst({ where: { id: req.params.id as string, organizationId } })
    if (!before) throw new HttpError(404, 'Emission source not found')
    if (data.facilityId) await assertFacilityInOrg(tx, organizationId, data.facilityId)
    const category = data.category ?? before.category
    const activityCode = data.activityCode === undefined ? (data.category && data.category !== before.category ? null : before.activityCode) : data.activityCode
    await assertActivityFits(tx, category, activityCode)
    if (activityCode !== before.activityCode) data.activityCode = activityCode
    const after = await tx.emissionSource.update({ where: { id: before.id }, data, include })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'source.updated', entityType: 'EmissionSource', entityId: before.id, before, after }, tx)
    return after
  })
  res.json(withScope(source))
}
