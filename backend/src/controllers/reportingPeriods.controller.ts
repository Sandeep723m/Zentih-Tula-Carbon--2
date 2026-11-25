import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma } from '../../generated/prisma/client.js'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'
import { grantedPeriods } from '../services/verifierScope.js'

const fields = {
  name: z.string().trim().min(1).max(100),
  startDate: z.iso.date().transform((d) => new Date(d)),
  endDate: z.iso.date().transform((d) => new Date(d)), // inclusive
}
const datesInOrder = (p: { startDate?: Date; endDate?: Date }) => !p.startDate || !p.endDate || p.endDate >= p.startDate
const datesMessage = { message: 'End date must be on or after the start date', path: ['endDate'] }

export const createPeriodSchema = z.object(fields).refine(datesInOrder, datesMessage)
export const updatePeriodSchema = z.object(fields).partial().refine(datesInOrder, datesMessage)

// Periods of one organisation must not overlap, so every activity date belongs to at most one period.
// ponytail: checked in the transaction, not by a DB exclusion constraint (needs btree_gist); two
// simultaneous creates of overlapping periods could both pass. Add the constraint if that ever matters.
async function assertNoOverlap(tx: Prisma.TransactionClient, organizationId: string, start: Date, end: Date, exceptId?: string) {
  const clash = await tx.reportingPeriod.findFirst({
    where: { organizationId, startDate: { lte: end }, endDate: { gte: start }, ...(exceptId ? { id: { not: exceptId } } : {}) },
  })
  if (clash) throw new HttpError(409, `Dates overlap the existing period "${clash.name}"`)
}

export const listPeriods: RequestHandler = async (req, res) => {
  const granted = await grantedPeriods(req)
  res.json(await getPrisma().reportingPeriod.findMany({ where: { organizationId: orgId(req), ...(granted ? { id: { in: granted } } : {}) }, orderBy: { startDate: 'desc' } }))
}

export const createPeriod: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const data = req.body as z.infer<typeof createPeriodSchema>
  const period = await getPrisma().$transaction(async (tx) => {
    await assertNoOverlap(tx, organizationId, data.startDate, data.endDate)
    const p = await tx.reportingPeriod.create({ data: { ...data, organizationId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'period.created', entityType: 'ReportingPeriod', entityId: p.id, after: p }, tx)
    return p
  })
  res.status(201).json(period)
}

export const updatePeriod: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const data = req.body as z.infer<typeof updatePeriodSchema>
  const period = await getPrisma().$transaction(async (tx) => {
    const before = await tx.reportingPeriod.findFirst({ where: { id: req.params.id as string, organizationId } })
    if (!before) throw new HttpError(404, 'Reporting period not found')
    if (before.status === 'LOCKED') throw new HttpError(409, 'This period is locked and cannot be changed')
    const start = data.startDate ?? before.startDate
    const end = data.endDate ?? before.endDate
    if (end < start) throw new HttpError(400, 'End date must be on or after the start date')
    await assertNoOverlap(tx, organizationId, start, end, before.id)
    const after = await tx.reportingPeriod.update({ where: { id: before.id }, data })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'period.updated', entityType: 'ReportingPeriod', entityId: before.id, before, after }, tx)
    return after
  })
  res.json(period)
}
