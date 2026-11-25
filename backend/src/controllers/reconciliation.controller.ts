// Compares the sources that describe one activity and records the value a person decides is right.
// Activity records are never changed here: a correction goes through the normal edit and review workflow.
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'
import { invoicesOf } from './documents.controller.js'

export const RECONCILIATION_PAGE_SIZE = 50
const day = (d: Date) => d.toISOString().slice(0, 10)
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 6 })
const unitKey = (u: string) => u.trim().toLowerCase()

export const listReconciliations: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const status = req.query.status === 'OPEN' || req.query.status === 'RESOLVED' ? (req.query.status as 'OPEN' | 'RESOLVED') : undefined
  const page = Math.max(1, Number(req.query.page) || 1)
  const db = getPrisma()
  const where = { organizationId, ...(status ? { status } : {}) }
  const [rows, total, groups] = await Promise.all([
    db.reconciliation.findMany({ where, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (page - 1) * RECONCILIATION_PAGE_SIZE, take: RECONCILIATION_PAGE_SIZE,
      select: { id: true, title: true, unit: true, status: true, resolvedValue: true, createdAt: true, items: { select: { value: true } } } }),
    db.reconciliation.count({ where }),
    db.reconciliation.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
  ])
  res.json({
    rows: rows.map(({ items, ...r }) => {
      const v = items.map((i) => Number(i.value))
      return { ...r, sources: v.length, spread: v.length ? Math.max(...v) - Math.min(...v) : 0 }
    }),
    total, page, pageSize: RECONCILIATION_PAGE_SIZE, counts: Object.fromEntries(groups.map((g) => [g.status, g._count])),
  })
}

// Why sources commonly disagree, worked out from the items themselves.
function reasonsFor(items: Array<{ kind: string; unit: string; value: number }>, unit: string) {
  const reasons: string[] = []
  if (items.some((i) => unitKey(i.unit) !== unitKey(unit))) reasons.push('Some sources use a different unit; convert before comparing.')
  if (items.some((i) => i.kind === 'METER') && items.some((i) => i.kind === 'BILL')) reasons.push('A bill may be based on an estimated reading while the meter shows the actual one.')
  if (items.some((i) => i.kind === 'OTHER_RECORD')) reasons.push('Purchases and consumption differ when fuel is stored: deliveries in one period can be used in the next.')
  if (items.some((i) => i.kind === 'RECORD') && items.some((i) => i.kind === 'BILL')) reasons.push('The record may cover different dates from the bill, or include an adjustment.')
  if (!reasons.length) reasons.push('Check that every source covers the same dates and site.')
  return reasons
}

export const getReconciliation: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const r = await getPrisma().reconciliation.findFirst({ where: { id: req.params.id as string, organizationId }, include: { items: { orderBy: { createdAt: 'asc' } } } })
  if (!r) throw new HttpError(404, 'Reconciliation not found')
  const log = await getPrisma().auditLog.findMany({ where: { organizationId, entityType: 'Reconciliation', entityId: r.id }, orderBy: { createdAt: 'asc' }, select: { action: true, after: true, createdAt: true, actorUserId: true } })
  const people = await getPrisma().user.findMany({ where: { id: { in: log.map((l) => l.actorUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })
  const history = log.map(({ actorUserId, ...l }) => ({ ...l, actor: people.find((p) => p.id === actorUserId)?.name ?? null }))
  const reference = Number(r.items[0]?.value ?? 0)
  res.json({
    ...r,
    items: r.items.map((i) => ({ ...i, difference: Number(i.value) - reference, differencePercent: reference ? ((Number(i.value) - reference) / reference) * 100 : null })),
    reasons: reasonsFor(r.items.map((i) => ({ kind: i.kind, unit: i.unit, value: Number(i.value) })), r.unit),
    history,
  })
}

// Starts from one record and gathers what else describes the same activity: its bills, their meter readings,
// and other records of the same activity, in the same unit, at the same facility over overlapping dates
// (a gas record is never compared with a biomass one, nor litres with tonnes).
export const reconcileRecord: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const db = getPrisma()
  const record = await db.activityRecord.findFirst({ where: { id: req.params.recordId as string, organizationId }, include: { emissionSource: true, facility: true } })
  if (!record) throw new HttpError(404, 'Record not found')
  const [matches, others] = await Promise.all([
    db.intakeMatch.findMany({ where: { activityRecordId: record.id, organizationId }, include: { document: { select: { id: true, fileName: true, result: true } } } }),
    db.activityRecord.findMany({ where: { organizationId, id: { not: record.id }, facilityId: record.facilityId, emissionSource: { category: record.emissionSource.category, activityCode: record.emissionSource.activityCode }, unit: record.unit, startDate: { lte: record.endDate }, endDate: { gte: record.startDate } }, include: { emissionSource: { select: { name: true } } }, take: 10 }),
  ])
  const items: Array<{ kind: string; label: string; value: string; unit: string; activityRecordId?: string; documentId?: string }> = [
    { kind: 'RECORD', label: `Entered: ${record.emissionSource.name}, ${day(record.startDate)} to ${day(record.endDate)}`, value: record.quantity.toString(), unit: record.unit, activityRecordId: record.id },
  ]
  for (const m of matches) {
    const inv = invoicesOf(m.document.result)[m.invoiceIndex]
    if (inv?.quantity) items.push({ kind: 'BILL', label: `Bill: ${m.document.fileName}${inv.documentNumber ? `, ${inv.documentNumber}` : ''}`, value: inv.quantity, unit: inv.unit ?? record.unit, documentId: m.document.id })
    if (inv?.meterPrevious && inv.meterCurrent) items.push({ kind: 'METER', label: `Meter readings on ${m.document.fileName}: ${fmt(Number(inv.meterPrevious))} to ${fmt(Number(inv.meterCurrent))}`, value: String(Number(inv.meterCurrent) - Number(inv.meterPrevious)), unit: inv.unit ?? record.unit, documentId: m.document.id })
  }
  for (const o of others) items.push({ kind: 'OTHER_RECORD', label: `Other record: ${o.emissionSource.name}, ${day(o.startDate)} to ${day(o.endDate)}`, value: o.quantity.toString(), unit: o.unit, activityRecordId: o.id })
  const r = await db.$transaction(async (tx) => {
    const created = await tx.reconciliation.create({ data: {
      organizationId, title: `${record.facility.code} · ${record.emissionSource.name} · ${day(record.startDate)} to ${day(record.endDate)}`.slice(0, 190),
      facilityId: record.facilityId, unit: record.unit, createdById: userId, items: { create: items.map((i) => ({ ...i, addedById: userId })) },
    } })
    await writeAudit({ organizationId, actorUserId: userId, action: 'reconciliation.created', entityType: 'Reconciliation', entityId: created.id, after: { recordId: record.id, sources: items.length } }, tx)
    return created
  })
  res.status(201).json({ id: r.id })
}

export const itemSchema = z.object({ label: z.string().trim().min(1).max(190), value: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Enter a number'), unit: z.string().trim().min(1).max(30) })

// A source the system does not hold, e.g. an ERP export or a generator log kept on paper.
export const addItem: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const r = await getPrisma().reconciliation.findFirst({ where: { id: req.params.id as string, organizationId } })
  if (!r) throw new HttpError(404, 'Reconciliation not found')
  if (r.status === 'RESOLVED') throw new HttpError(409, 'Reopen the reconciliation before adding sources.')
  const body = req.body as z.infer<typeof itemSchema>
  await getPrisma().$transaction(async (tx) => {
    const i = await tx.reconciliationItem.create({ data: { reconciliationId: r.id, kind: 'MANUAL', ...body, addedById: req.auth!.userId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'reconciliation.source_added', entityType: 'Reconciliation', entityId: r.id, after: { itemId: i.id, ...body } }, tx)
  })
  res.status(204).end()
}

export const resolveSchema = z.object({ value: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Enter a number'), explanation: z.string().trim().min(1, 'Explain the value chosen').max(190) })

export const resolveReconciliation: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const reopen = req.query.reopen === '1'
  const r = await getPrisma().reconciliation.findFirst({ where: { id: req.params.id as string, organizationId } })
  if (!r) throw new HttpError(404, 'Reconciliation not found')
  if (reopen ? r.status !== 'RESOLVED' : r.status === 'RESOLVED') throw new HttpError(409, reopen ? 'It is not resolved.' : 'It is already resolved.')
  const parsed = reopen ? null : resolveSchema.safeParse(req.body)
  if (parsed && !parsed.success) throw new HttpError(400, parsed.error.issues[0].message)
  await getPrisma().$transaction(async (tx) => {
    await tx.reconciliation.update({ where: { id: r.id }, data: parsed?.data
      ? { status: 'RESOLVED', resolvedValue: parsed.data.value, resolution: parsed.data.explanation, resolvedById: req.auth!.userId, resolvedAt: new Date() }
      : { status: 'OPEN', resolvedValue: null, resolution: null, resolvedById: null, resolvedAt: null } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: reopen ? 'reconciliation.reopened' : 'reconciliation.resolved', entityType: 'Reconciliation', entityId: r.id, before: { value: r.resolvedValue?.toString() ?? null, explanation: r.resolution }, after: parsed?.data ?? {} }, tx)
  })
  res.status(204).end()
}
