// Closing a reporting period: a checklist of what is still open, locking on the latest calculation run
// (whose results become the final figures), and an audited reopen. Runs and audit history are never removed.
import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma } from '../../generated/prisma/client.js'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'

type Db = Prisma.TransactionClient | ReturnType<typeof getPrisma>

export interface ChecklistItem { key: string; label: string; ok: boolean; mandatory: boolean; detail: string }

export async function periodChecklist(db: Db, organizationId: string, reportingPeriodId: string) {
  const period = await db.reportingPeriod.findFirst({ where: { id: reportingPeriodId, organizationId } })
  if (!period) throw new HttpError(404, 'Reporting period not found')
  // May run inside the lock transaction (one connection), so queries go one after another.
  const byStatus = await db.activityRecord.groupBy({ by: ['status'], where: { organizationId, reportingPeriodId }, _count: true })
  const run = await db.calculationRun.findFirst({ where: { organizationId, reportingPeriodId }, orderBy: { createdAt: 'desc' } })
  const lastReview = await db.activityRecord.findFirst({ where: { organizationId, reportingPeriodId, reviewedAt: { not: null } }, orderBy: { reviewedAt: 'desc' }, select: { reviewedAt: true } })
  const boundary = await db.orgBoundary.findFirst({ where: { organizationId, status: 'APPROVED', effectiveFrom: { lte: period.startDate } }, orderBy: { version: 'desc' }, select: { version: true } })
  const count = (s: string) => byStatus.find((b) => b.status === s)?._count ?? 0
  const approved = count('APPROVED')
  const blocked = run ? await db.calculationResult.count({ where: { runId: run.id, status: 'BLOCKED' } }) : 0
  const unconfirmed = run ? await db.calculationResult.count({ where: { runId: run.id, status: 'CALCULATED', needsConfirmation: true, confirmedAt: null } }) : 0
  // Current = no approval or return since the run, and the run covered exactly the approved records.
  const current = !!run && (!lastReview?.reviewedAt || lastReview.reviewedAt <= run.createdAt) && run.recordCount + run.notCalculableCount === approved

  const gaps = await monthGaps(db, organizationId, reportingPeriodId)
  const items: ChecklistItem[] = [
    { key: 'drafts', label: 'No draft records', ok: count('DRAFT') === 0, mandatory: true, detail: `${count('DRAFT')} draft record(s): submit or delete them.` },
    { key: 'submitted', label: 'Every submitted record reviewed', ok: count('SUBMITTED') === 0, mandatory: true, detail: `${count('SUBMITTED')} record(s) awaiting review.` },
    { key: 'returned', label: 'No records returned for correction', ok: count('RETURNED') === 0, mandatory: true, detail: `${count('RETURNED')} record(s) returned and not yet resubmitted.` },
    { key: 'approved', label: 'At least one approved record', ok: approved > 0, mandatory: true, detail: `${approved} approved record(s).` },
    { key: 'run', label: 'Calculation run is up to date', ok: current, mandatory: true, detail: !run ? 'No calculation run yet.' : current ? `Latest run ${run.createdAt.toISOString()}.` : 'Records were approved or returned after the latest run: run the calculation again.' },
    // Checked against a run; before the first run they are not failures, the "run" item is.
    { key: 'blocked', label: 'No blocked calculations', ok: blocked === 0, mandatory: true, detail: run ? `${blocked} blocked result(s) in the latest run: fix their inputs or factors and recalculate.` : 'Checked after the first run.' },
    { key: 'warnings', label: 'Every warning confirmed with a reason', ok: unconfirmed === 0, mandatory: true, detail: run ? `${unconfirmed} result(s) awaiting confirmation.` : 'Checked after the first run.' },
    { key: 'notCalculable', label: 'Every approved record has a calculation method', ok: (run?.notCalculableCount ?? 0) === 0, mandatory: false, detail: `${run?.notCalculableCount ?? 0} approved record(s) (agriculture, landfill) have no calculation method and are not in the totals.` },
    { key: 'gaps', label: 'No months missing between a source\'s first and last record', ok: gaps.length === 0, mandatory: false, detail: gaps.length ? `No data for ${gaps.slice(0, 5).join('; ')}${gaps.length > 5 ? `; and ${gaps.length - 5} more source(s)` : ''}. Confirm there was no consumption (V-20).` : 'Every source is covered month by month.' },
    { key: 'boundary', label: 'Approved boundary in force at the period start', ok: !!boundary, mandatory: false, detail: boundary ? `Boundary v${boundary.version} applies: counted totals are available.` : 'No approved boundary starts on or before this period: only gross totals can be reported (Super Admin → Boundary Setup).' },
  ]
  const counts = { draft: count('DRAFT'), submitted: count('SUBMITTED'), returned: count('RETURNED'), approved, blocked, unconfirmed, notCalculable: run?.notCalculableCount ?? 0 }
  return { period, run, items, counts, current, canLock: period.status === 'OPEN' && items.every((i) => i.ok || !i.mandatory) }
}

// Everything that needs a person, across the organisation's open periods, plus sources the engine
// cannot calculate. Shown on the dashboard, Calculations and Reports so nobody finds out by surprise.
export const getAttention: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const db = getPrisma()
  const open = await db.reportingPeriod.findMany({ where: { organizationId, status: 'OPEN' }, orderBy: { startDate: 'desc' } })
  const periods = []
  for (const p of open) {
    const c = await periodChecklist(db, organizationId, p.id)
    periods.push({
      period: { id: p.id, name: p.name }, counts: c.counts, current: c.current,
      run: c.run && { id: c.run.id, createdAt: c.run.createdAt }, canLock: c.canLock,
      open: c.items.filter((i) => !i.ok).map(({ key, label, detail, mandatory }) => ({ key, label, detail, mandatory })),
    })
  }
  const unresolvedSources = await db.emissionSource.findMany({
    where: { organizationId, isActive: true, activityCode: null, category: { in: ['FUEL_COMBUSTION', 'FUGITIVE_GAS'] } },
    select: { id: true, name: true, facility: { select: { code: true } } },
  })
  res.json({ periods, unresolvedSources })
}

// V-20: months with no data between a source's first and last submitted record in the period.
async function monthGaps(db: Db, organizationId: string, reportingPeriodId: string) {
  const rows = await db.activityRecord.findMany({
    where: { organizationId, reportingPeriodId, status: { not: 'DRAFT' } },
    select: { emissionSourceId: true, startDate: true, endDate: true, emissionSource: { select: { name: true, facility: { select: { code: true } } } } },
  })
  const month = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth()
  const label = (m: number) => `${Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, '0')}`
  const out: string[] = []
  for (const id of new Set(rows.map((r) => r.emissionSourceId))) {
    const mine = rows.filter((r) => r.emissionSourceId === id)
    const first = Math.min(...mine.map((r) => month(r.startDate)))
    const last = Math.max(...mine.map((r) => month(r.endDate)))
    const missing = []
    for (let m = first; m <= last; m++) if (!mine.some((r) => month(r.startDate) <= m && month(r.endDate) >= m)) missing.push(label(m))
    if (missing.length) out.push(`${mine[0].emissionSource.facility.code} ${mine[0].emissionSource.name}: ${missing.join(', ')}`)
  }
  return out
}

export const getChecklist: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const db = getPrisma()
  const c = await periodChecklist(db, organizationId, req.params.id as string)
  const events = await db.periodLockEvent.findMany({
    where: { organizationId, reportingPeriodId: c.period.id }, include: { actor: { select: { name: true } } }, orderBy: { createdAt: 'desc' },
  })
  res.json({ ...c, events })
}

export const lockPeriod: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const period = await getPrisma().$transaction(async (tx) => {
    const c = await periodChecklist(tx, organizationId, req.params.id as string)
    if (c.period.status === 'LOCKED') throw new HttpError(409, 'This period is already locked')
    if (!c.canLock) throw new HttpError(409, `Cannot lock yet: ${c.items.filter((i) => i.mandatory && !i.ok).map((i) => i.label.toLowerCase()).join('; ')}`)
    const changed = await tx.reportingPeriod.updateMany({
      where: { id: c.period.id, status: 'OPEN' },
      data: { status: 'LOCKED', lockedAt: new Date(), lockedById: userId, finalRunId: c.run!.id },
    })
    if (changed.count !== 1) throw new HttpError(409, 'This period was locked by someone else just now')
    await tx.periodLockEvent.create({ data: { organizationId, reportingPeriodId: c.period.id, action: 'LOCKED', runId: c.run!.id, actorId: userId } })
    await writeAudit({ organizationId, actorUserId: userId, action: 'period.locked', entityType: 'ReportingPeriod', entityId: c.period.id, after: { finalRunId: c.run!.id } }, tx)
    return tx.reportingPeriod.findUniqueOrThrow({ where: { id: c.period.id } })
  })
  res.json(period)
}

export const reopenSchema = z.object({ reason: z.string().trim().min(10, 'Explain why the period is reopened (at least 10 characters)').max(1000) })

// Reopening clears the final run so reports show provisional figures again; the run itself is kept.
export const reopenPeriod: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const { reason } = req.body as z.infer<typeof reopenSchema>
  const period = await getPrisma().$transaction(async (tx) => {
    const p = await tx.reportingPeriod.findFirst({ where: { id: req.params.id as string, organizationId } })
    if (!p) throw new HttpError(404, 'Reporting period not found')
    const changed = await tx.reportingPeriod.updateMany({ where: { id: p.id, status: 'LOCKED' }, data: { status: 'OPEN', lockedAt: null, lockedById: null, finalRunId: null } })
    if (changed.count !== 1) throw new HttpError(409, 'This period is not locked')
    await tx.periodLockEvent.create({ data: { organizationId, reportingPeriodId: p.id, action: 'REOPENED', runId: p.finalRunId, actorId: userId, reason } })
    await writeAudit({ organizationId, actorUserId: userId, action: 'period.reopened', entityType: 'ReportingPeriod', entityId: p.id, before: { status: 'LOCKED', finalRunId: p.finalRunId }, after: { status: 'OPEN' }, reason }, tx)
    return tx.reportingPeriod.findUniqueOrThrow({ where: { id: p.id } })
  })
  res.json(period)
}
