import type { Request, RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma } from '../../generated/prisma/client.js'
import { orgId, type AuthContext } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { allowedUnitsOf } from '../calc/core/units.js'
import { parametersFor, resolveActivity } from '../calc/registry.js'
import { previewDraft, previewRecord } from '../calc/service.js'
import { can } from '../auth/permissions.js'
import { optionalText } from '../middleware/validate.js'
import { writeAudit } from '../services/audit.js'
import { storage } from '../storage/index.js'
import { isVerifier, recordScope } from '../services/verifierScope.js'

type Tx = Prisma.TransactionClient

const quantity = z
  .union([z.number(), z.string()])
  .transform((q) => String(q).trim())
  .pipe(z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Quantity must be a number with at most 6 decimal places'))
// Zero is allowed only where the method needs it (a refrigerant mass balance with no top-up); see assertValidLinks.

const fields = {
  facilityId: z.uuid('Select a facility'),
  reportingPeriodId: z.uuid('Select a reporting period'),
  emissionSourceId: z.uuid('Select an emission source'),
  startDate: z.iso.date('Enter a valid start date'),
  endDate: z.iso.date('Enter a valid end date'),
  quantity,
  unit: z.string().trim().min(1, 'Enter a unit').max(20),
  parameters: z.record(z.string(), z.unknown()).optional(), // checked against the calculation method in assertValidLinks
  notes: optionalText(2000),
}
const datesInOrder = (r: { startDate?: string; endDate?: string }) => !r.startDate || !r.endDate || r.endDate >= r.startDate
const datesMessage = { message: 'End date must be on or after the start date', path: ['endDate'] }

export const createActivitySchema = z.object(fields).refine(datesInOrder, datesMessage)
export const updateActivitySchema = z.object(fields).partial().refine(datesInOrder, datesMessage)

type Links = Pick<z.infer<typeof createActivitySchema>, 'facilityId' | 'reportingPeriodId' | 'emissionSourceId' | 'startDate' | 'endDate' | 'quantity' | 'unit' | 'parameters'>

const iso = (d: Date) => d.toISOString().slice(0, 10)

// Server-side check that every reference belongs to this organisation and fits together, and that unit
// and parameters suit the source's calculation method. Returns the parameters to store.
// Anything from another organisation looks exactly like "not found".
async function assertValidLinks(tx: Tx, organizationId: string, r: Links) {
  // Runs inside a transaction (one connection), so the lookups go one after another.
  const facility = await tx.facility.findFirst({ where: { id: r.facilityId, organizationId } })
  const period = await tx.reportingPeriod.findFirst({ where: { id: r.reportingPeriodId, organizationId } })
  const source = await tx.emissionSource.findFirst({ where: { id: r.emissionSourceId, organizationId } })
  if (!facility) throw new HttpError(400, 'Facility not found')
  if (!period) throw new HttpError(400, 'Reporting period not found')
  if (!source) throw new HttpError(400, 'Emission source not found')
  if (!facility.isActive) throw new HttpError(400, 'This facility is inactive')
  if (source.facilityId !== facility.id) throw new HttpError(400, 'The emission source does not belong to the selected facility')
  if (!source.isActive) throw new HttpError(400, 'This emission source is inactive')
  if (period.status === 'LOCKED') throw new HttpError(409, `Reporting period "${period.name}" is locked`)
  if (r.startDate < iso(period.startDate) || r.endDate > iso(period.endDate)) {
    throw new HttpError(400, `Dates must fall within the reporting period (${iso(period.startDate)} to ${iso(period.endDate)})`)
  }
  if (Number(r.quantity) === 0 && source.category !== 'FUGITIVE_GAS') throw new HttpError(400, 'Quantity must be greater than zero')
  // V-16: activities the engine calculates accept only units their formula can convert. A source with no
  // activity chosen yet is checked against every activity of its category.
  const types = await tx.activityType.findMany({ where: { sourceCategory: source.category } })
  const resolved = resolveActivity(source, types)
  const allowed = allowedUnitsOf(resolved?.types.length ? resolved.types : types.filter((t) => !source.activityCode || t.code === source.activityCode))
  if (allowed.length && !allowed.some((u) => u.toLowerCase() === r.unit.trim().toLowerCase())) {
    throw new HttpError(400, `This unit is not valid for the selected emission source. Use one of: ${allowed.join(', ')}.`)
  }
  // Extra inputs are whatever the formula's methods declare; with no method there are none.
  if (!resolved) {
    if (r.parameters && Object.keys(r.parameters).length) throw new HttpError(400, 'This emission source takes no extra calculation inputs')
    return undefined
  }
  const parameters = parametersFor(resolved.formulaCode).schema.parse(r.parameters ?? {})
  return Object.keys(parameters).length ? (parameters as Prisma.InputJsonValue) : undefined
}

// Drafts and returned records can be changed by their creator, or by a Tenant Admin. Submitted and
// approved records are frozen; a reviewer returns an approved record to reopen it.
function assertEditable(record: { status: string; createdById: string; reportingPeriod: { status: string; name: string } }, auth: AuthContext) {
  if (record.status !== 'DRAFT' && record.status !== 'RETURNED') throw new HttpError(409, 'Only draft or returned records can be changed')
  if (record.createdById !== auth.userId && auth.role !== 'TENANT_ADMIN') throw new HttpError(403, 'You can only change your own drafts')
  if (record.reportingPeriod.status === 'LOCKED') throw new HttpError(409, `Reporting period "${record.reportingPeriod.name}" is locked`)
}

async function findRecord(tx: Tx, req: Request) {
  const r = await tx.activityRecord.findFirst({
    where: { id: req.params.id as string, organizationId: orgId(req) },
    include: { reportingPeriod: { select: { status: true, name: true } } },
  })
  if (!r) throw new HttpError(404, 'Activity record not found')
  return r
}

const detail = {
  facility: { select: { id: true, name: true, code: true } },
  reportingPeriod: { select: { id: true, name: true, startDate: true, endDate: true, status: true } },
  emissionSource: { select: { id: true, name: true, category: true, material: true, defaultUnit: true } },
  createdBy: { select: { id: true, name: true } },
  updatedBy: { select: { id: true, name: true } },
  evidence: {
    select: { id: true, fileName: true, mimeType: true, sizeBytes: true, createdAt: true, uploadedBy: { select: { name: true } } },
    orderBy: { createdAt: 'asc' as const },
  },
} satisfies Prisma.ActivityRecordInclude

const toDates = <T extends { startDate?: string; endDate?: string }>(d: T) => ({
  ...d,
  ...(d.startDate ? { startDate: new Date(d.startDate) } : {}),
  ...(d.endDate ? { endDate: new Date(d.endDate) } : {}),
})

// ---- Read ------------------------------------------------------------------

const listQuery = z.object({
  status: z.enum(['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED']).optional(),
  category: z.enum(['FUEL_COMBUSTION', 'FUGITIVE_GAS', 'PURCHASED_ELECTRICITY', 'PURCHASED_ENERGY', 'PROCESS', 'REMOVAL']).optional(),
  facilityId: z.uuid().optional(),
  reportingPeriodId: z.uuid().optional(),
  mine: z.literal('true').optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  pageSize: z.coerce.number().int().refine((value) => [12, 24, 50].includes(value), 'Unsupported page size').optional(),
})
export const ACTIVITY_PAGE_SIZE = 50

export const listActivities: RequestHandler = async (req, res) => {
  const q = listQuery.parse(req.query)
  const pageSize = q.pageSize ?? ACTIVITY_PAGE_SIZE
  // Counts for the status and category tabs: every filter except the tab's own.
  const base: Prisma.ActivityRecordWhereInput = {
    AND: [
      { organizationId: orgId(req), facilityId: q.facilityId, reportingPeriodId: q.reportingPeriodId, ...(q.mine ? { createdById: req.auth!.userId } : {}) },
      await recordScope(req),
    ],
  }
  const where: Prisma.ActivityRecordWhereInput = { AND: [base, { status: q.status }, q.category ? { emissionSource: { category: q.category } } : {}] }
  const db = getPrisma()
  const [byStatus, byCategory] = await Promise.all([
    db.activityRecord.groupBy({ by: ['status'], where: { AND: [base, q.category ? { emissionSource: { category: q.category } } : {}] }, _count: true }),
    db.emissionSource.findMany({ where: { organizationId: orgId(req) }, select: { category: true, _count: { select: { activityRecords: { where: { AND: [base, { status: q.status }] } } } } } }),
  ])
  const counts = {
    status: Object.fromEntries(byStatus.map((b) => [b.status, b._count])),
    category: byCategory.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.category]: (acc[s.category] ?? 0) + s._count.activityRecords }), {}),
  }
  const [rows, total] = await Promise.all([
    db.activityRecord.findMany({
      where,
      include: { facility: detail.facility, reportingPeriod: detail.reportingPeriod, emissionSource: detail.emissionSource, createdBy: detail.createdBy, _count: { select: { evidence: true } } },
      orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
      skip: (q.page - 1) * pageSize,
      take: pageSize,
    }),
    db.activityRecord.count({ where }),
  ])
  let ledgerRows: typeof rows | Array<(typeof rows)[number] & { dashboardEmissions: string | null }> = rows
  if (can(req.auth!.role!, 'calc.read') && rows.length) {
    const results = await db.calculationResult.findMany({
      where: { activityRecordId: { in: rows.map((row) => row.id) } },
      orderBy: { createdAt: 'desc' },
      select: { activityRecordId: true, runId: true, tCO2e: true },
    })
    const latestRun = new Map<string, string>()
    const totals = new Map<string, number>()
    for (const result of results) {
      const runId = latestRun.get(result.activityRecordId)
      if (!runId) latestRun.set(result.activityRecordId, result.runId)
      if (latestRun.get(result.activityRecordId) === result.runId && result.tCO2e != null) {
        totals.set(result.activityRecordId, (totals.get(result.activityRecordId) ?? 0) + Number(result.tCO2e))
      }
    }
    ledgerRows = rows.map((row) => ({ ...row, dashboardEmissions: totals.has(row.id) ? (totals.get(row.id) ?? 0).toFixed(3) : null }))
  }
  res.json({ rows: ledgerRows, total, page: q.page, pageSize, counts })
}

export const getActivity: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const organizationId = orgId(req)
  const role = req.auth!.role!
  const r = await db.activityRecord.findFirst({
    where: { AND: [{ id: req.params.id as string, organizationId }, await recordScope(req)] },
    include: { ...detail, reviewedBy: { select: { id: true, name: true } }, reviews: { include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } },
  })
  if (!r) throw new HttpError(404, 'Activity record not found')
  if (isVerifier(req)) await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'verifier.record_viewed', entityType: 'ActivityRecord', entityId: r.id })
  // Reviewers see what the calculation would give before approving: warnings are not resolved by approval.
  const preview = can(role, 'activity.review') && (r.status === 'SUBMITTED' || r.status === 'RETURNED') ? await previewRecord(db, organizationId, r.id) : null
  // Results of this record in its latest calculation run (one per method), for roles that may see results.
  const latest = can(role, 'calc.read') ? await db.calculationResult.findFirst({ where: { activityRecordId: r.id }, orderBy: { createdAt: 'desc' }, select: { runId: true } }) : null
  const calculations = latest
    ? await db.calculationResult.findMany({
      where: { activityRecordId: r.id, runId: latest.runId },
      include: { run: { select: { id: true, createdAt: true, engineVersion: true } }, confirmedBy: { select: { name: true } }, emissionFactor: { select: { code: true, source: true, sourceVersion: true, numeratorUnit: true, denominatorUnit: true, organizationId: true, tier: true } } },
      orderBy: { formulaCode: 'asc' },
    })
    : []
  res.json({ ...r, calculation: calculations[0] ?? null, calculations, preview })
}

export const activitySummary: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const db = getPrisma()
  const scoped = { organizationId, ...(await recordScope(req)) }
  const [byStatus, groups, recent, myDrafts] = await Promise.all([
    db.activityRecord.groupBy({ by: ['status'], where: scoped, _count: true }),
    db.activityRecord.groupBy({ by: ['facilityId', 'reportingPeriodId', 'status'], where: scoped, _count: true }),
    db.activityRecord.findMany({ where: scoped, include: { facility: detail.facility, reportingPeriod: detail.reportingPeriod, emissionSource: detail.emissionSource, createdBy: detail.createdBy }, orderBy: { updatedAt: 'desc' }, take: 10 }),
    db.activityRecord.findMany({ where: { organizationId, status: { in: ['DRAFT', 'RETURNED'] }, createdById: req.auth!.userId }, include: { facility: detail.facility, emissionSource: detail.emissionSource }, orderBy: { updatedAt: 'desc' }, take: 10 }),
  ])
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0
  // Names only for the facilities and periods that actually appear in the grouping.
  const [facilities, periods] = await Promise.all([
    db.facility.findMany({ where: { organizationId, id: { in: [...new Set(groups.map((g) => g.facilityId))] } }, select: { id: true, name: true, code: true } }),
    db.reportingPeriod.findMany({ where: { organizationId, id: { in: [...new Set(groups.map((g) => g.reportingPeriodId))] } }, select: { id: true, name: true, status: true } }),
  ])

  const table = new Map<string, { facility: (typeof facilities)[number]; period: (typeof periods)[number]; draft: number; submitted: number; returned: number; approved: number }>()
  for (const g of groups) {
    const key = `${g.facilityId}|${g.reportingPeriodId}`
    const row = table.get(key) ?? {
      facility: facilities.find((f) => f.id === g.facilityId)!,
      period: periods.find((p) => p.id === g.reportingPeriodId)!,
      draft: 0,
      submitted: 0,
      returned: 0,
      approved: 0,
    }
    row[g.status === 'DRAFT' ? 'draft' : g.status === 'SUBMITTED' ? 'submitted' : g.status === 'RETURNED' ? 'returned' : 'approved'] += g._count
    table.set(key, row)
  }

  res.json({
    total: count('DRAFT') + count('SUBMITTED') + count('RETURNED') + count('APPROVED'),
    draft: count('DRAFT'),
    submitted: count('SUBMITTED'),
    returned: count('RETURNED'),
    approved: count('APPROVED'),
    byFacilityPeriod: [...table.values()].sort((a, b) => a.facility.name.localeCompare(b.facility.name) || a.period.name.localeCompare(b.period.name)),
    recent,
    myDrafts,
  })
}

// ---- Write -----------------------------------------------------------------

export const createActivity: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const data = req.body as z.infer<typeof createActivitySchema>
  const record = await getPrisma().$transaction(async (tx) => {
    const parameters = await assertValidLinks(tx, organizationId, data)
    const r = await tx.activityRecord.create({ data: { ...toDates(data), parameters, organizationId, createdById: userId, updatedById: userId }, include: detail })
    await writeAudit({ organizationId, actorUserId: userId, action: 'activity.created', entityType: 'ActivityRecord', entityId: r.id, after: data }, tx)
    return r
  })
  res.status(201).json(record)
}

export const updateActivity: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const data = req.body as z.infer<typeof updateActivitySchema>
  const record = await getPrisma().$transaction(async (tx) => {
    const before = await findRecord(tx, req)
    assertEditable(before, req.auth!)
    const merged = {
      facilityId: data.facilityId ?? before.facilityId,
      reportingPeriodId: data.reportingPeriodId ?? before.reportingPeriodId,
      emissionSourceId: data.emissionSourceId ?? before.emissionSourceId,
      startDate: data.startDate ?? iso(before.startDate),
      endDate: data.endDate ?? iso(before.endDate),
      quantity: data.quantity ?? before.quantity.toString(),
      unit: data.unit ?? before.unit,
      parameters: data.parameters ?? (before.parameters as Record<string, unknown> | null) ?? undefined,
    }
    if (merged.endDate < merged.startDate) throw new HttpError(400, 'End date must be on or after the start date')
    const parameters = await assertValidLinks(tx, organizationId, merged)
    const after = await tx.activityRecord.update({ where: { id: before.id }, data: { ...toDates(data), parameters, updatedById: userId }, include: detail })
    const { reportingPeriod: _, ...beforeRow } = before
    await writeAudit({ organizationId, actorUserId: userId, action: 'activity.updated', entityType: 'ActivityRecord', entityId: before.id, before: beforeRow, after: data }, tx)
    return after
  })
  res.json(record)
}

export const submitActivity: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const db = getPrisma()
  const record = await db.$transaction(async (tx) => {
    const r = await findRecord(tx, req)
    assertEditable(r, req.auth!)
    await assertValidLinks(tx, organizationId, { ...r, quantity: r.quantity.toString(), startDate: iso(r.startDate), endDate: iso(r.endDate), parameters: (r.parameters as Record<string, unknown> | null) ?? undefined })
    // V-07: the same source cannot have two submitted records covering the same days.
    const clash = await tx.activityRecord.findFirst({
      where: { organizationId, emissionSourceId: r.emissionSourceId, id: { not: r.id }, status: { in: ['SUBMITTED', 'APPROVED'] }, startDate: { lte: r.endDate }, endDate: { gte: r.startDate } },
    })
    if (clash) throw new HttpError(409, `This period overlaps one already submitted for this source (${iso(clash.startDate)} to ${iso(clash.endDate)}). Edit the earlier entry or change the dates.`, { clashId: clash.id })
    const params = (r.parameters ?? {}) as Record<string, unknown>
    if (params.co2Factor && !String(params.co2FactorSource ?? '').trim()) throw new HttpError(400, 'Give the source of your own CO2 factor (the analysis or certificate reference) before submitting.')
    const org = await tx.organization.findUniqueOrThrow({ where: { id: organizationId } })
    if (org.requireEvidenceOnSubmit && (await tx.evidence.count({ where: { activityRecordId: r.id } })) === 0) {
      return null // rejected below, outside the transaction, so the audit entry is kept
    }
    const after = await tx.activityRecord.update({ where: { id: r.id }, data: { status: 'SUBMITTED', submittedAt: new Date(), updatedById: userId }, include: detail })
    await tx.activityReview.create({ data: { organizationId, activityRecordId: r.id, action: 'SUBMITTED', fromStatus: r.status, toStatus: 'SUBMITTED', actorId: userId } })
    await writeAudit({ organizationId, actorUserId: userId, action: r.status === 'RETURNED' ? 'activity.resubmitted' : 'activity.submitted', entityType: 'ActivityRecord', entityId: r.id, before: { status: r.status }, after: { status: 'SUBMITTED' } }, tx)
    return after
  })
  if (!record) {
    await writeAudit({ organizationId, actorUserId: userId, action: 'activity.submit_blocked', entityType: 'ActivityRecord', entityId: req.params.id as string, reason: 'Supporting evidence is required' })
    throw new HttpError(400, 'Attach supporting evidence before submitting')
  }
  res.json(record)
}

// Deleting a draft removes its evidence files too (after the database change commits).
export const deleteActivity: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const keys = await getPrisma().$transaction(async (tx) => {
    const r = await findRecord(tx, req)
    assertEditable(r, req.auth!)
    if (r.status !== 'DRAFT') throw new HttpError(409, 'Only drafts can be deleted; a returned record keeps its review history')
    const files = await tx.evidence.findMany({ where: { activityRecordId: r.id }, select: { storageKey: true } })
    await tx.evidence.deleteMany({ where: { activityRecordId: r.id } })
    await tx.activityRecord.delete({ where: { id: r.id } })
    const { reportingPeriod: _, ...row } = r
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'activity.deleted', entityType: 'ActivityRecord', entityId: r.id, before: row }, tx)
    return files.map((f) => f.storageKey)
  })
  await removeFiles(keys)
  res.status(204).end()
}

// ---- Review ------------------------------------------------------------------

// Live check of unsaved form values: the same rules as save, submit (V-07) and the calculation preview,
// returned as findings instead of errors so the form can show them while the user types.
export const checkActivitySchema = z.object(fields).extend({ id: z.uuid().optional() })
export const checkActivity: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const body = req.body as z.infer<typeof checkActivitySchema>
  const db = getPrisma()
  const issues: Array<{ code: string; severity: 'BLOCK' | 'WARN'; message: string; clashId?: string }> = []
  if (body.endDate < body.startDate) issues.push({ code: 'DATES', severity: 'BLOCK', message: datesMessage.message })
  let parameters: unknown
  try {
    parameters = await assertValidLinks(db as unknown as Tx, organizationId, body)
  } catch (err) {
    const message = err instanceof z.ZodError ? err.issues.map((i) => `${i.path.join('.') || 'Input'}: ${i.message}`).join('; ') : (err as Error).message
    issues.push({ code: 'INPUT', severity: 'BLOCK', message })
    return res.json({ issues, outcomes: null })
  }
  const clash = await db.activityRecord.findFirst({
    where: { organizationId, emissionSourceId: body.emissionSourceId, ...(body.id ? { id: { not: body.id } } : {}), status: { in: ['SUBMITTED', 'APPROVED'] }, startDate: { lte: new Date(body.endDate) }, endDate: { gte: new Date(body.startDate) } },
  })
  if (clash) issues.push({ code: 'V-07', severity: 'BLOCK', clashId: clash.id, message: `Overlaps a record already submitted for this source (${iso(clash.startDate)} to ${iso(clash.endDate)}). Change the dates, or open that record and correct it instead.` })
  const [source, facility, period] = await Promise.all([
    db.emissionSource.findFirstOrThrow({ where: { id: body.emissionSourceId, organizationId }, select: { category: true, activityCode: true } }),
    db.facility.findFirstOrThrow({ where: { id: body.facilityId, organizationId }, select: { gridLocation: true } }),
    db.reportingPeriod.findFirstOrThrow({ where: { id: body.reportingPeriodId, organizationId } }),
  ])
  const outcomes = await previewDraft(db, organizationId, {
    id: body.id ?? '', emissionSourceId: body.emissionSourceId, facilityId: body.facilityId, startDate: new Date(body.startDate), endDate: new Date(body.endDate),
    quantity: body.quantity, unit: body.unit, parameters: parameters ?? {}, emissionSource: source, facility,
  }, period.startDate)
  res.json({ issues, outcomes })
}

export const returnSchema = z.object({ reason: z.string().trim().min(3, 'Give the reason (at least 3 characters)').max(1000) })

// Approve (SUBMITTED → APPROVED) or return for correction (SUBMITTED or APPROVED → RETURNED, with a reason).
// Reviewers and Data Entry cannot approve their own records (segregation of duties); Tenant Admin can. The status change is a
// conditional update, so two reviewers acting at once cannot both succeed.
function reviewAction(action: 'APPROVED' | 'RETURNED'): RequestHandler {
  return async (req, res) => {
    const organizationId = orgId(req)
    const userId = req.auth!.userId
    const reason = action === 'RETURNED' ? (req.body as z.infer<typeof returnSchema>).reason : null
    const from: Array<'SUBMITTED' | 'APPROVED'> = action === 'APPROVED' ? ['SUBMITTED'] : ['SUBMITTED', 'APPROVED']
    const record = await getPrisma().$transaction(async (tx) => {
      const r = await findRecord(tx, req)
      if (r.reportingPeriod.status === 'LOCKED') throw new HttpError(409, `Reporting period "${r.reportingPeriod.name}" is locked`)
      if (!from.includes(r.status as 'SUBMITTED')) {
        throw new HttpError(409, action === 'APPROVED' ? `Only submitted records can be approved (this one is ${r.status.toLowerCase()})` : `Only submitted or approved records can be returned (this one is ${r.status.toLowerCase()})`)
      }
      if (req.auth!.role !== 'TENANT_ADMIN' && (r.createdById === userId || r.updatedById === userId)) throw new HttpError(403, 'You cannot review a record you entered or changed')
      // Own values replace a standard default, so the document behind them must be on the record before it is approved.
      const own = ownValues(r.parameters)
      if (action === 'APPROVED' && own.length && (await tx.evidence.count({ where: { activityRecordId: r.id } })) === 0) {
        throw new HttpError(409, `This record uses its own ${own.join(', ')} instead of the standard value. Attach the analysis or certificate to the record before approving it.`)
      }
      const changed = await tx.activityRecord.updateMany({
        where: { id: r.id, status: r.status },
        data: { status: action, reviewedById: userId, reviewedAt: new Date(), ...(reason ? { returnReason: reason } : {}) },
      })
      if (changed.count !== 1) throw new HttpError(409, 'This record was reviewed by someone else just now. Reload it.')
      await tx.activityReview.create({ data: { organizationId, activityRecordId: r.id, action, fromStatus: r.status, toStatus: action, actorId: userId, comment: reason } })
      await writeAudit({ organizationId, actorUserId: userId, action: action === 'APPROVED' ? 'activity.approved' : 'activity.returned', entityType: 'ActivityRecord', entityId: r.id, before: { status: r.status }, after: { status: action }, reason: reason ?? undefined }, tx)
      return tx.activityRecord.findUniqueOrThrow({ where: { id: r.id }, include: detail })
    })
    res.json(record)
  }
}
export const approveActivity = reviewAction('APPROVED')
export const returnActivity = reviewAction('RETURNED')

// ponytail: a failed file delete leaves an unreferenced file (logged), never a dangling DB row.
// Add a periodic sweep of storage keys missing from Evidence if this shows up in the logs.
export async function removeFiles(keys: string[]) {
  for (const k of keys) await storage.remove(k).catch((e) => console.error(`Could not delete stored file ${k}:`, e))
}

// Own values the calculation asks a document for (an own CO2 factor, an own calorific value).
export function ownValues(parameters: unknown) {
  const p = (parameters ?? {}) as Record<string, unknown>
  return [['co2Factor', 'CO2 factor'], ['ncv', 'calorific value']].filter(([k]) => p[k] != null && p[k] !== '').map(([, label]) => label)
}

export { assertEditable, findRecord }
