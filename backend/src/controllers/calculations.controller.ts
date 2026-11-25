import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma } from '../../generated/prisma/client.js'
import { orgId } from '../auth/session.js'
import { dec, ZERO } from '../calc/core/decimal.js'
import { dryRun, NothingApproved, PeriodLocked, PeriodNotFound, runPeriodCalculation } from '../calc/service.js'
import { LINES } from '../calc/core/types.js'
import { assertPeriodVisible, grantedPeriods } from '../services/verifierScope.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'

export const runSchema = z.object({
  reportingPeriodId: z.uuid('Select a reporting period'),
  gwpSet: z.enum(['AR6', 'AR5']).default('AR6'), // one set per run and report (V-12)
  gwpReason: z.string().trim().min(10).max(500).optional(), // required for AR5 (J-09)
}).refine((b) => b.gwpSet === 'AR6' || !!b.gwpReason, { message: 'Give the reason for reporting on AR5 (e.g. the scheme that requires it)', path: ['gwpReason'] })

// Calculates every approved record of the period whose activity has a formula; see calc/service.ts.
export const runCalculation: RequestHandler = async (req, res) => {
  const { reportingPeriodId, gwpSet, gwpReason } = req.body as z.infer<typeof runSchema>
  try {
    res.status(201).json(await runPeriodCalculation(getPrisma(), orgId(req), reportingPeriodId, req.auth!.userId, { set: gwpSet, reason: gwpReason }))
  } catch (e) {
    if (e instanceof PeriodNotFound) throw new HttpError(404, 'Reporting period not found')
    if (e instanceof NothingApproved) throw new HttpError(409, e.message)
    if (e instanceof PeriodLocked) throw new HttpError(409, 'This reporting period is locked; reopen it before recalculating')
    throw e
  }
}

const runSummary = {
  id: true, reportingPeriodId: true, engineVersion: true, recordCount: true, calculatedCount: true, blockedCount: true,
  notCalculableCount: true, scope2LocationTCO2e: true, scope2LocationBoundaryTCO2e: true, boundaryId: true, totals: true, gwpSet: true, gwpReason: true, createdAt: true,
  runBy: { select: { name: true } }, reportingPeriod: { select: { id: true, name: true, startDate: true, endDate: true, status: true, finalRunId: true } },
} satisfies Prisma.CalculationRunSelect

export const listRuns: RequestHandler = async (req, res) => {
  const q = z.object({ reportingPeriodId: z.uuid().optional() }).parse(req.query)
  const granted = await grantedPeriods(req)
  const runs = await getPrisma().calculationRun.findMany({
    where: { organizationId: orgId(req), AND: [{ reportingPeriodId: q.reportingPeriodId }, granted ? { reportingPeriodId: { in: granted } } : {}] },
    select: runSummary,
    orderBy: { createdAt: 'desc' },
    take: 50,
  })
  res.json(runs)
}

export const RESULT_PAGE_SIZE = 50
const resultQuery = z.object({
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  status: z.enum(['CALCULATED', 'BLOCKED']).optional(),
  attention: z.literal('true').optional(), // results awaiting confirmation
  line: z.enum(LINES).optional(),
  category: z.enum(['FUEL_COMBUSTION', 'FUGITIVE_GAS', 'PURCHASED_ELECTRICITY', 'PURCHASED_ENERGY', 'PROCESS', 'REMOVAL']).optional(),
})

export const getRun: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const q = resultQuery.parse(req.query)
  const db = getPrisma()
  const run = await db.calculationRun.findFirst({ where: { id: req.params.id as string, organizationId }, select: runSummary })
  if (!run) throw new HttpError(404, 'Calculation run not found')
  await assertPeriodVisible(req, run.reportingPeriodId, 'Calculation run not found')
  const boundary = run.boundaryId ? await db.orgBoundary.findUnique({ where: { id: run.boundaryId }, select: { version: true, approach: true } }) : null

  const where: Prisma.CalculationResultWhereInput = {
    runId: run.id, status: q.status, line: q.line, ...(q.category ? { activityRecord: { emissionSource: { category: q.category } } } : {}), ...(q.attention ? { needsConfirmation: true, confirmedAt: null } : {}),
  }
  const [rows, total, byFacility, awaiting] = await Promise.all([
    db.calculationResult.findMany({
      where,
      include: {
        activityRecord: { select: { id: true, startDate: true, endDate: true, quantity: true, unit: true, emissionSource: { select: { name: true, activityCode: true } } } },
        facility: { select: { id: true, name: true, code: true } },
        emissionFactor: { select: { code: true, source: true, sourceVersion: true, numeratorUnit: true, denominatorUnit: true, organizationId: true, tier: true } },
        confirmedBy: { select: { name: true } },
      },
      orderBy: [{ facility: { name: 'asc' } }, { activityRecord: { startDate: 'asc' } }, { activityRecordId: 'asc' }, { formulaCode: 'asc' }],
      skip: (q.page - 1) * RESULT_PAGE_SIZE,
      take: RESULT_PAGE_SIZE,
    }),
    db.calculationResult.count({ where }),
    db.calculationResult.groupBy({ by: ['facilityId', 'line', 'status'], where: { runId: run.id }, _sum: { tCO2e: true }, _count: true, _max: { inclusionPct: true } }),
    db.calculationResult.count({ where: { runId: run.id, needsConfirmation: true, confirmedAt: null } }),
  ])

  // Category × line matrix (gross and counted), for the run summary.
  // ponytail: one pass over the run's results in memory; aggregate in SQL if runs reach ~100k results.
  const light = await db.calculationResult.findMany({
    where: { runId: run.id },
    select: { line: true, status: true, tCO2e: true, biogenicTCO2: true, inclusionPct: true, needsConfirmation: true, confirmedAt: true, activityRecord: { select: { emissionSource: { select: { category: true } } } } },
  })
  const categories: Record<string, { results: number; blocked: number; toConfirm: number; lines: Record<string, { gross: string; counted: string | null }> }> = {}
  for (const r of light) {
    const c = (categories[r.activityRecord.emissionSource.category] ??= { results: 0, blocked: 0, toConfirm: 0, lines: {} })
    c.results += 1
    if (r.status === 'BLOCKED') { c.blocked += 1; continue }
    if (r.needsConfirmation && !r.confirmedAt) c.toConfirm += 1
    for (const [line, v] of [[r.line, r.tCO2e], ['BIOGENIC_MEMO', r.biogenicTCO2]] as const) {
      if (v == null) continue
      const cur = (c.lines[line] ??= { gross: '0', counted: '0' })
      cur.gross = dec(cur.gross).add(dec(v)).toString()
      cur.counted = cur.counted == null || r.inclusionPct == null ? null : dec(cur.counted).add(dec(v).mul(dec(r.inclusionPct)).div(100)).toString()
    }
  }

  const facilities = await db.facility.findMany({ where: { id: { in: [...new Set(byFacility.map((g) => g.facilityId))] } }, select: { id: true, name: true, code: true } })
  // Per facility and tab 09 line: unrounded sums (R-05); the share counted is the facility's for that scope.
  const sites = facilities.map((f) => {
    const groups = byFacility.filter((g) => g.facilityId === f.id)
    const lines = Object.fromEntries(LINES.map((line) => {
      const ok = groups.find((g) => g.line === line && g.status === 'CALCULATED')
      if (!ok) return [line, null]
      const tCO2e = ok._sum.tCO2e ? dec(ok._sum.tCO2e) : ZERO
      const pct = ok._max.inclusionPct ?? null
      return [line, { tCO2e: tCO2e.toString(), inclusionPct: pct?.toString() ?? null, countedTCO2e: pct == null ? null : tCO2e.mul(dec(pct)).div(100).toString() }]
    }))
    return {
      facility: f,
      calculated: groups.filter((g) => g.status === 'CALCULATED').reduce((n, g) => n + g._count, 0),
      blocked: groups.filter((g) => g.status === 'BLOCKED').reduce((n, g) => n + g._count, 0),
      lines,
    }
  }).sort((a, b) => a.facility.name.localeCompare(b.facility.name))

  res.json({
    run: { ...run, boundary },
    sites,
    awaitingConfirmation: awaiting,
    categories,
    // Result counts for the line tabs.
    tabCounts: {
      ...Object.fromEntries(LINES.map((line) => [line, byFacility.filter((g) => g.line === line).reduce((n, g) => n + g._count, 0)])),
      BLOCKED: byFacility.filter((g) => g.status === 'BLOCKED').reduce((n, g) => n + g._count, 0),
      ALL: byFacility.reduce((n, g) => n + g._count, 0),
    },
    results: { rows: rows.map((r) => ({ ...r, kgCO2e: r.tCO2e ? dec(r.tCO2e).mul(1000).toString() : null })), total, page: q.page, pageSize: RESULT_PAGE_SIZE },
  })
}

export const confirmSchema = z.object({ reason: z.string().trim().min(3, 'Give a reason (at least 3 characters)').max(1000) })

// Warnings that ask for a document. They can only be confirmed once a file is attached to the record.
const NEEDS_EVIDENCE = new Set(['V-11', 'R-05'])
type Confirmable = { issues: unknown; activityRecord: { createdById: string; updatedById: string; _count: { evidence: number } } }
const confirmBlock = (r: Confirmable, userId: string) => {
  if (r.activityRecord.createdById === userId || r.activityRecord.updatedById === userId) return 'You entered or changed this record, so another person must confirm its warnings.'
  if (!r.activityRecord._count.evidence && (r.issues as Array<{ code: string }>).some((i) => NEEDS_EVIDENCE.has(i.code))) return 'A warning on this result asks for the analysis or certificate. Attach it to the activity record before confirming.'
  return null
}
const confirmInclude = { activityRecord: { select: { createdById: true, updatedById: true, _count: { select: { evidence: true } } } } }

// When a rule says the user must confirm, the engine stores the reason with the result.
export const confirmResult: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const { reason } = req.body as z.infer<typeof confirmSchema>
  const db = getPrisma()
  const result = await db.$transaction(async (tx) => {
    const r = await tx.calculationResult.findFirst({ where: { id: req.params.id as string, organizationId }, include: { run: { select: { reportingPeriod: { select: { status: true } } } }, ...confirmInclude } })
    if (!r) throw new HttpError(404, 'Calculation result not found')
    const why = confirmBlock(r, req.auth!.userId)
    if (why) throw new HttpError(409, why)
    if (r.run.reportingPeriod.status === 'LOCKED') throw new HttpError(409, 'This reporting period is locked')
    if (!r.needsConfirmation) throw new HttpError(409, 'This result does not need confirmation')
    if (r.status !== 'CALCULATED') throw new HttpError(409, 'A blocked result cannot be confirmed; fix its inputs and recalculate')
    // Conditional, so two people confirming at once cannot both succeed.
    const changed = await tx.calculationResult.updateMany({
      where: { id: r.id, confirmedAt: null },
      data: { confirmedById: req.auth!.userId, confirmedAt: new Date(), confirmationReason: reason },
    })
    if (changed.count !== 1) throw new HttpError(409, 'This result is already confirmed')
    const updated = await tx.calculationResult.findUniqueOrThrow({ where: { id: r.id } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'calculation.result_confirmed', entityType: 'CalculationResult', entityId: r.id, reason, after: { issues: r.issues } }, tx)
    return updated
  })
  res.json(result)
}

export const confirmRunSchema = confirmSchema.extend({ code: z.string().trim().max(20).optional() }) // only results with this issue code

// Confirms every result of a run still awaiting confirmation (optionally only those with one issue code),
// with one reason. Each result gets its own audit entry, exactly as if confirmed one by one.
export const confirmRun: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const { reason, code } = req.body as z.infer<typeof confirmRunSchema>
  let skipped = 0
  const confirmed = await getPrisma().$transaction(async (tx) => {
    const run = await tx.calculationRun.findFirst({ where: { id: req.params.id as string, organizationId }, include: { reportingPeriod: { select: { status: true } } } })
    if (!run) throw new HttpError(404, 'Calculation run not found')
    if (run.reportingPeriod.status === 'LOCKED') throw new HttpError(409, 'This reporting period is locked')
    const waiting = (await tx.calculationResult.findMany({ where: { runId: run.id, status: 'CALCULATED', needsConfirmation: true, confirmedAt: null }, select: { id: true, issues: true, ...confirmInclude } }))
      .filter((r) => !code || (r.issues as Array<{ code: string }>).some((i) => i.code === code))
    const pending = waiting.filter((r) => !confirmBlock(r, req.auth!.userId))
    skipped = waiting.length - pending.length
    if (!pending.length) throw new HttpError(409, skipped ? `None of the ${skipped} waiting result(s) can be confirmed by you: either you entered the record, or the warning asks for a document that is not attached yet.` : 'Nothing is awaiting confirmation')
    const now = new Date()
    await tx.calculationResult.updateMany({ where: { id: { in: pending.map((r) => r.id) }, confirmedAt: null }, data: { confirmedById: req.auth!.userId, confirmedAt: now, confirmationReason: reason } })
    for (const r of pending) {
      await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'calculation.result_confirmed', entityType: 'CalculationResult', entityId: r.id, reason, after: { issues: r.issues, bulk: true } }, tx)
    }
    return pending.length
  })
  res.json({ confirmed, skipped })
}

// Before a run: what each category holds and what the approved records would give (nothing stored).
export const previewPeriod: RequestHandler = async (req, res) => {
  const { reportingPeriodId } = z.object({ reportingPeriodId: z.uuid('Select a reporting period') }).parse(req.query)
  try {
    res.json(await dryRun(getPrisma(), orgId(req), reportingPeriodId))
  } catch (e) {
    if (e instanceof PeriodNotFound) throw new HttpError(404, 'Reporting period not found')
    throw e
  }
}

// ---- Comparing two runs ------------------------------------------------------------------
// For each record: what it was and what it became, and why the result moved. Confirmed runs are only read, never revised.
export const compareQuerySchema = z.object({ from: z.uuid(), to: z.uuid() })
type Cause = 'ACTIVITY_DATA' | 'FACTOR' | 'GWP' | 'METHODOLOGY' | 'BOUNDARY' | 'ADDED' | 'REMOVED' | 'UNCHANGED'

export const compareRuns: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const q = compareQuerySchema.safeParse(req.query)
  if (!q.success) throw new HttpError(400, 'Choose two runs to compare')
  const db = getPrisma()
  const runSelect = { id: true, createdAt: true, gwpSet: true, boundaryId: true, engineVersion: true, reportingPeriodId: true, runBy: { select: { name: true } } } as const
  const [a, b] = await Promise.all([q.data.from, q.data.to].map((id) => db.calculationRun.findFirst({ where: { id, organizationId }, select: runSelect })))
  if (!a || !b) throw new HttpError(404, 'Run not found')
  for (const r of [a, b]) await assertPeriodVisible(req, r.reportingPeriodId, 'Run not found')
  const resultSelect = { activityRecordId: true, formulaCode: true, line: true, status: true, inputs: true, factorValue: true, inclusionPct: true, tCO2e: true,
    emissionFactor: { select: { code: true, source: true, sourceVersion: true, numeratorUnit: true, denominatorUnit: true, organizationId: true, tier: true } },
    activityRecord: { select: { returnReason: true, facility: { select: { code: true } }, emissionSource: { select: { name: true } } } } } as const
  const [before, after] = await Promise.all([a, b].map((r) => db.calculationResult.findMany({ where: { runId: r.id }, select: resultSelect })))
  const key = (r: { activityRecordId: string; line: string }) => `${r.activityRecordId}|${r.line}`
  const oldBy = new Map(before.map((r) => [key(r), r]))
  const newBy = new Map(after.map((r) => [key(r), r]))
  const qty = (r?: (typeof before)[number]) => { const i = r?.inputs as { quantity?: string; unit?: string } | undefined; return i?.quantity ? `${i.quantity} ${i.unit ?? ''}`.trim() : null }
  const t = (r?: (typeof before)[number]) => (r?.tCO2e ? Number(r.tCO2e) : 0)
  const factor = (r?: (typeof before)[number]) => (r?.emissionFactor ? `${r.emissionFactor.code} (${r.emissionFactor.source} ${r.emissionFactor.sourceVersion}): ${Number(r.factorValue)} ${r.emissionFactor.numeratorUnit}/${r.emissionFactor.denominatorUnit}` : null)
  const rows = [...new Set([...oldBy.keys(), ...newBy.keys()])].map((k) => {
    const o = oldBy.get(k), n = newBy.get(k), ref = (n ?? o)!
    const causes: Cause[] = !o ? ['ADDED'] : !n ? ['REMOVED'] : ([
      qty(o) !== qty(n) && 'ACTIVITY_DATA',
      (factor(o) !== factor(n)) && 'FACTOR',
      a.gwpSet !== b.gwpSet && 'GWP',
      o.formulaCode !== n.formulaCode && 'METHODOLOGY',
      (String(o.inclusionPct) !== String(n.inclusionPct) || a.boundaryId !== b.boundaryId) && 'BOUNDARY',
    ].filter(Boolean) as Cause[])
    return {
      activityRecordId: ref.activityRecordId, line: ref.line, facility: ref.activityRecord.facility.code, source: ref.activityRecord.emissionSource.name,
      quantityBefore: qty(o), quantityAfter: qty(n), factorBefore: factor(o), factorAfter: factor(n), formulaBefore: o?.formulaCode ?? null, formulaAfter: n?.formulaCode ?? null,
      tCO2eBefore: o?.tCO2e?.toString() ?? null, tCO2eAfter: n?.tCO2e?.toString() ?? null, change: t(n) - t(o),
      causes: causes.length ? causes : ['UNCHANGED'], note: ref.activityRecord.returnReason,
    }
  }).filter((r) => r.causes[0] !== 'UNCHANGED' || r.change !== 0)
    .sort((x, y) => Math.abs(y.change) - Math.abs(x.change))
  const byCause: Record<string, number> = {}
  for (const r of rows) for (const c of r.causes) byCause[c] = (byCause[c] ?? 0) + r.change / r.causes.length // split evenly when several causes apply
  res.json({
    from: a, to: b, gwpChanged: a.gwpSet !== b.gwpSet, boundaryChanged: a.boundaryId !== b.boundaryId, engineChanged: a.engineVersion !== b.engineVersion,
    totalBefore: before.reduce((s, r) => s + t(r), 0), totalAfter: after.reduce((s, r) => s + t(r), 0), byCause, rows: rows.slice(0, 500), total: rows.length,
  })
}
