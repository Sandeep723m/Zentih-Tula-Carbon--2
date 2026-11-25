// Runs the engine over a reporting period and stores the run. Called by the API today; written
// without request objects so a background job or CLI can call it when periods grow large.
import type { Prisma, PrismaClient } from '../../generated/prisma/client.js'
import { writeAudit } from '../services/audit.js'
import { sharePct, type BoundaryFacility } from './core/boundary.js'
import { dec, ZERO, type Dec } from './core/decimal.js'
import { factorLabel, usableFactor } from './core/factorRules.js'
import { LINES, warn, type GwpSet, type ReportingLine } from './core/types.js'
import { calculateAll, ENGINE_VERSION, resolveActivity } from './registry.js'

export class PeriodNotFound extends Error {}
export class PeriodLocked extends Error {}
export class NothingApproved extends Error {}

type Db = PrismaClient | Prisma.TransactionClient

// Reference rows, loaded once per run (or preview) for one organisation: the platform library plus that
// organisation's own factors, approved or in use only, and only rows whose gas and units fit their activity's
// formula (factorRules.ts), so a draft, superseded or mis-entered factor is never selected. Another organisation's
// factors are never loaded. Results already stored keep the factor they used, so this never changes a past result.
export async function loadReference(db: Db, organizationId: string) {
  const [activityTypes, units, regions, current, fuelProperties] = await Promise.all([
    db.activityType.findMany(), db.unit.findMany(), db.gridRegion.findMany(),
    db.emissionFactor.findMany({ where: { status: { in: ['APPROVED', 'IN_USE'] }, OR: [{ organizationId: null }, { organizationId }] } }),
    db.fuelProperty.findMany({ where: { organizationId, status: { in: ['APPROVED', 'DRAFT'] } } }),
  ])
  const byCode = new Map(activityTypes.map((a) => [a.code, a]))
  // TC-ARC-006 section 4: a platform factor replaced by a newer published edition stays in force within its
  // end-dated validity window, so an open period keeps the version in force at its start. A platform factor
  // end-dated without a replacement, and any organisation factor once superseded, are not selected.
  const replaced = current.filter((f) => !f.organizationId && f.supersedesId).map((f) => f.supersedesId!)
  const pinned = replaced.length ? await db.emissionFactor.findMany({ where: { id: { in: replaced }, organizationId: null, status: 'SUPERSEDED', validTo: { not: null } } }) : []
  const factors = [...current.filter((f) => usableFactor(f, byCode, units)), ...pinned.filter((f) => usableFactor({ ...f, status: 'APPROVED' }, byCode, units))]
  return { activityTypes, units, regions, factors, fuelProperties }
}
type Loaded = Awaited<ReturnType<typeof loadReference>>

interface CalcRecord {
  id: string; emissionSourceId: string; facilityId: string; startDate: Date; endDate: Date
  quantity: { toString(): string }; unit: string; parameters: unknown
  emissionSource: { category: string; activityCode: string | null }
  facility: { gridLocation: string | null }
}

// Every method's outcome for one record; null when its activity has no calculation yet. `history` are other
// approved records, for the V-05 range check.
export function outcomesFor(r: CalcRecord, periodStart: Date, ref: Loaded, gwpSet: GwpSet = 'AR6', history: HistoryRow[] = [], periodEnd?: Date) {
  const resolved = resolveActivity(r.emissionSource, ref.activityTypes)
  if (!resolved) return null
  const results = calculateAll(
    { quantity: r.quantity.toString(), unit: r.unit, gridLocation: r.facility.gridLocation, periodStart, parameters: (r.parameters ?? {}) as Record<string, unknown>,
      facilityId: r.facilityId, startDate: r.startDate, endDate: r.endDate },
    { units: ref.units, regions: ref.regions, factors: ref.factors, activityTypes: resolved.types, gwpSet, fuelProperties: ref.fuelProperties },
    resolved.formulaCode,
  )
  const short = periodEnd ? shortOfPeriod(r, periodStart, periodEnd) : null
  if (short) for (const x of results) x.outcome.issues.push(short)
  const range = rangeCheck(r, history)
  return range ? results.map((x) => ({ ...x, outcome: { ...x.outcome, issues: [...x.outcome.issues, range], needsConfirmation: x.outcome.status === 'CALCULATED' } })) : results
}

// A record that starts or ends on a period boundary but stops a few days short of the other one usually means a
// mistyped date (e.g. a year to 13 March in a year ending 31 March). Shown as a warning; nothing is blocked.
function shortOfPeriod(r: { startDate: Date; endDate: Date }, start: Date, end: Date) {
  const gapEnd = Math.round((end.getTime() - r.endDate.getTime()) / DAY), gapStart = Math.round((r.startDate.getTime() - start.getTime()) / DAY)
  const days = gapStart === 0 && gapEnd > 0 && gapEnd < 31 ? gapEnd : gapEnd === 0 && gapStart > 0 && gapStart < 31 ? gapStart : 0
  return days ? warn('P-01', `This record covers ${r.startDate.toISOString().slice(0, 10)} to ${r.endDate.toISOString().slice(0, 10)}, ${days} day(s) short of the reporting period (${start.toISOString().slice(0, 10)} to ${end.toISOString().slice(0, 10)}). If it should cover the whole period, correct the dates.`) : null
}

// V-05: more than 40% away from the trailing 12-month mean of the same source (same unit). Records cover
// different spans (a month, a year), so quantities are compared per day.
export type HistoryRow = { id: string; emissionSourceId: string; startDate: Date; endDate: Date; quantity: { toString(): string }; unit: string }
const DAY = 86_400_000
const perDay = (h: Pick<HistoryRow, 'startDate' | 'endDate' | 'quantity'>) => dec(h.quantity.toString()).div((h.endDate.getTime() - h.startDate.getTime()) / DAY + 1)
export function rangeCheck(r: CalcRecord, history: HistoryRow[]) {
  const from = r.startDate.getTime() - 365 * DAY
  const prior = history.filter((h) => h.id !== r.id && h.emissionSourceId === r.emissionSourceId && h.unit.toLowerCase() === r.unit.toLowerCase()
    && h.endDate.getTime() < r.startDate.getTime() && h.endDate.getTime() >= from)
  if (!prior.length) return null
  const mean = prior.reduce((s, h) => s.add(perDay(h)), ZERO).div(prior.length)
  if (mean.isZero()) return null
  const diff = perDay(r).sub(mean).div(mean).mul(100)
  return diff.abs().gt(40) ? warn('V-05', `This figure is ${diff.toDecimalPlaces(0).abs()}% ${diff.isPositive() ? 'above' : 'below'} the 12-month average for this source (per day). Confirm the reading, or record why it is correct.`) : null
}

const historyOf = (db: Db, organizationId: string, sourceIds: string[], before: Date) => db.activityRecord.findMany({
  where: { organizationId, status: 'APPROVED', emissionSourceId: { in: sourceIds }, endDate: { gte: new Date(before.getTime() - 366 * DAY) } },
  select: { id: true, emissionSourceId: true, startDate: true, endDate: true, quantity: true, unit: true },
})

const recordInclude = {
  emissionSource: { select: { category: true, activityCode: true } },
  facility: { select: { gridLocation: true } },
} as const

// What a calculation of this record would give today, without storing anything (shown to reviewers).
export async function previewRecord(db: PrismaClient, organizationId: string, recordId: string) {
  const r = await db.activityRecord.findFirst({ where: { id: recordId, organizationId }, include: { ...recordInclude, reportingPeriod: true } })
  if (!r) return null
  const results = outcomesFor(r, r.reportingPeriod.startDate, await loadReference(db, organizationId), 'AR6', await historyOf(db, organizationId, [r.emissionSourceId], r.startDate), r.reportingPeriod.endDate)
  return results?.map(({ method, outcome }) => ({
    formulaCode: method.formulaCode, title: method.title, status: outcome.status, tCO2e: outcome.tCO2e?.toString() ?? null,
    biogenicTCO2: outcome.biogenicTCO2?.toString() ?? null, issues: outcome.issues, factorCode: outcome.factor?.code ?? null,
  })) ?? null
}

// The same preview for values not yet saved (the entry form checks as you type).
export async function previewDraft(db: PrismaClient, organizationId: string, r: CalcRecord, periodStart: Date) {
  const results = outcomesFor(r, periodStart, await loadReference(db, organizationId), 'AR6', await historyOf(db, organizationId, [r.emissionSourceId], r.startDate))
  return results?.map(({ method, outcome }) => ({
    formulaCode: method.formulaCode, title: method.title, status: outcome.status, tCO2e: outcome.tCO2e?.toString() ?? null,
    biogenicTCO2: outcome.biogenicTCO2?.toString() ?? null, issues: outcome.issues, factorCode: outcome.factor?.code ?? null,
  })) ?? null
}

// ponytail: one transaction and one in-memory pass per run; move to a background job with batched
// inserts once a period holds tens of thousands of records.
export async function runPeriodCalculation(db: PrismaClient, organizationId: string, reportingPeriodId: string, userId: string, gwp: { set: GwpSet; reason?: string } = { set: 'AR6' }) {
  const period = await db.reportingPeriod.findFirst({ where: { id: reportingPeriodId, organizationId } })
  if (!period) throw new PeriodNotFound()
  if (period.status === 'LOCKED') throw new PeriodLocked()

  const [ref, records, boundary] = await Promise.all([
    loadReference(db, organizationId),
    // Only approved records are calculated; drafts, submitted and returned ones are not.
    db.activityRecord.findMany({ where: { organizationId, reportingPeriodId, status: 'APPROVED' }, include: recordInclude, orderBy: [{ startDate: 'asc' }, { id: 'asc' }] }),
    // The approved boundary in force at the start of the period.
    db.orgBoundary.findFirst({ where: { organizationId, status: 'APPROVED', effectiveFrom: { lte: period.startDate } }, orderBy: { version: 'desc' } }),
  ])
  if (!records.length) {
    // An empty run would only show zeros; say instead where the period's records are.
    const waiting = await db.activityRecord.groupBy({ by: ['status'], where: { organizationId, reportingPeriodId }, _count: true })
    const n = (st: string) => waiting.find((w) => w.status === st)?._count ?? 0
    throw new NothingApproved(`Nothing to calculate: this period has no approved records (${n('SUBMITTED')} awaiting review, ${n('RETURNED')} returned, ${n('DRAFT')} draft). Approve records in the Review Queue first.`)
  }
  const snapshot = (boundary?.snapshot ?? null) as BoundaryFacility[] | null

  const history = await historyOf(db, organizationId, [...new Set(records.map((r) => r.emissionSourceId))], period.startDate)
  const perRecord = records.map((record) => ({ record, outcomes: outcomesFor(record, period.startDate, ref, gwp.set, history, period.endDate) }))
  const calculable = perRecord.filter((x) => x.outcomes)
  const results = calculable.flatMap(({ record, outcomes }) => outcomes!.map(({ method, outcome: o }) => ({
    record, o, line: method.line,
    pct: boundary && snapshot ? sharePct(boundary.approach, method.scope, snapshot.find((f) => f.id === record.facilityId)) : null,
  })))

  // Tab 09: each line summed on its own, unrounded, never added to another (G-03, G-04, G-07); biogenic CO2
  // is a memo line (G-05). Counted totals only when every calculated facility has a share in the boundary.
  const sum = (rows: typeof results, value: (x: (typeof results)[number]) => Dec | null | undefined) => {
    const ok = rows.filter((x) => x.o.status === 'CALCULATED' && value(x) != null)
    return {
      gross: ok.reduce((s, x) => s.add(value(x)!), ZERO),
      counted: boundary && snapshot && ok.every((x) => x.pct != null) ? ok.reduce((s, x) => s.add(value(x)!.mul(x.pct!).div(100)), ZERO) : null,
    }
  }
  const totals: Record<ReportingLine | 'BIOGENIC_MEMO', { gross: Dec; counted: Dec | null }> = {
    ...(Object.fromEntries(LINES.map((line) => [line, sum(results.filter((x) => x.line === line), (x) => x.o.tCO2e)])) as Record<ReportingLine, { gross: Dec; counted: Dec | null }>),
    BIOGENIC_MEMO: sum(results.filter((x) => x.line === 'SCOPE1'), (x) => x.o.biogenicTCO2),
  }
  const calculated = calculable.filter((x) => x.outcomes!.every((m) => m.outcome.status === 'CALCULATED')).length
  const totalsJson = Object.fromEntries(Object.entries(totals).map(([k, v]) => [k, { gross: v.gross.toString(), counted: v.counted?.toString() ?? null }]))

  return db.$transaction(async (tx) => {
    const run = await tx.calculationRun.create({
      data: {
        organizationId, reportingPeriodId, engineVersion: ENGINE_VERSION, runById: userId, gwpSet: gwp.set, gwpBasis: 'GWP-100', gwpReason: gwp.reason ?? null,
        recordCount: calculable.length, calculatedCount: calculated, blockedCount: calculable.length - calculated,
        notCalculableCount: records.length - calculable.length,
        scope2LocationTCO2e: totals.SCOPE2_LOCATION.gross.toString(), boundaryId: boundary?.id ?? null,
        scope2LocationBoundaryTCO2e: totals.SCOPE2_LOCATION.counted?.toString() ?? null,
        totals: totalsJson,
      },
    })
    await tx.calculationResult.createMany({
      data: results.map(({ record, o, pct, line }) => ({
        runId: run.id, organizationId, activityRecordId: record.id, facilityId: record.facilityId,
        formulaCode: o.formulaCode, line, status: o.status, inputs: o.inputs as Prisma.InputJsonValue,
        emissionFactorId: o.factor?.id ?? null, factorValue: o.factor ? o.factor.value.toString() : null,
        factorUnit: o.factor ? `${o.factor.numeratorUnit} / ${o.factor.denominatorUnit}` : null,
        // TC-ARC-006 3.3: the factor as it was at calculation time (value and units are in their own columns).
        selection: (o.selection || o.factor ? { ...(o.selection ?? {}), ...(o.factor ? { factorSnapshot: {
          code: o.factor.code, source: o.factor.source, sourceVersion: o.factor.sourceVersion, tier: o.factor.tier, library: factorLabel(o.factor),
          validFrom: o.factor.validFrom.toISOString().slice(0, 10), validTo: o.factor.validTo?.toISOString().slice(0, 10) ?? null,
        } } : {}) } : undefined) as Prisma.InputJsonValue | undefined,
        tCO2e: o.tCO2e?.toString() ?? null, biogenicTCO2: o.biogenicTCO2?.toString() ?? null,
        gases: (o.gases ?? undefined) as Prisma.InputJsonValue | undefined,
        inclusionPct: pct, issues: o.issues as unknown as Prisma.InputJsonValue,
        needsConfirmation: o.needsConfirmation,
      })),
    })
    // TC-ARC-006 3: the organisation's approved factors this run used are now in use, and frozen.
    const used = factorsUsed(results.map((x) => x.o))
    const nowInUse = await tx.emissionFactor.findMany({ where: { organizationId, status: 'APPROVED', OR: [{ id: { in: used.ids } }, { code: { in: used.codes } }] }, select: { id: true, code: true } })
    if (nowInUse.length) {
      await tx.emissionFactor.updateMany({ where: { id: { in: nowInUse.map((f) => f.id) } }, data: { status: 'IN_USE' } })
      for (const f of nowInUse) await writeAudit({ organizationId, actorUserId: userId, action: 'emission_factor.in_use', entityType: 'EmissionFactor', entityId: f.id, after: { runId: run.id } }, tx)
    }
    await writeAudit({
      organizationId, actorUserId: userId, action: 'calculation.run', entityType: 'CalculationRun', entityId: run.id,
      reason: gwp.reason,
      after: { reportingPeriodId, engineVersion: ENGINE_VERSION, gwpSet: gwp.set, gwpBasis: 'GWP-100', records: calculable.length, calculated, totals: totalsJson },
    }, tx)
    return run
  })
}

// "What will be calculated": every record of the period by source category, and for approved ones the result
// the engine would give now (nothing stored). Shown before a run so nobody runs blind.
// ponytail: up to 200 records per category are listed (counts are complete); page it if periods grow past that.
export async function dryRun(db: PrismaClient, organizationId: string, reportingPeriodId: string) {
  const period = await db.reportingPeriod.findFirst({ where: { id: reportingPeriodId, organizationId } })
  if (!period) throw new PeriodNotFound()
  const records = await db.activityRecord.findMany({
    where: { organizationId, reportingPeriodId },
    include: { ...recordInclude, emissionSource: { select: { name: true, category: true, activityCode: true, activityType: { select: { name: true } } } }, facility: { select: { name: true, code: true, gridLocation: true } } },
    orderBy: [{ startDate: 'asc' }, { id: 'asc' }],
  })
  const approved = records.filter((r) => r.status === 'APPROVED')
  const [ref, history] = await Promise.all([loadReference(db, organizationId), historyOf(db, organizationId, [...new Set(approved.map((r) => r.emissionSourceId))], period.startDate)])
  const categories = new Map<string, { category: string; counts: Record<string, number>; records: unknown[]; estimate: Record<string, Dec> }>()
  for (const r of records) {
    const c = categories.get(r.emissionSource.category) ?? { category: r.emissionSource.category, counts: { DRAFT: 0, SUBMITTED: 0, RETURNED: 0, APPROVED: 0 }, records: [], estimate: {} }
    c.counts[r.status] += 1
    const outcomes = r.status === 'APPROVED' ? outcomesFor(r, period.startDate, ref, 'AR6', history, period.endDate) : null
    for (const o of outcomes ?? []) if (o.outcome.tCO2e) c.estimate[o.method.line] = (c.estimate[o.method.line] ?? ZERO).add(o.outcome.tCO2e)
    if (c.records.length < 200) {
      c.records.push({
        id: r.id, status: r.status, facility: r.facility.name, source: r.emissionSource.name, activity: r.emissionSource.activityType?.name ?? null,
        startDate: r.startDate, endDate: r.endDate, quantity: r.quantity.toString(), unit: r.unit,
        calculable: r.status !== 'APPROVED' || outcomes !== null,
        results: outcomes?.map(({ method, outcome: o }) => ({ formulaCode: method.formulaCode, line: method.line, status: o.status, tCO2e: o.tCO2e?.toString() ?? null, biogenicTCO2: o.biogenicTCO2?.toString() ?? null, issues: o.issues })) ?? [],
      })
    }
    categories.set(r.emissionSource.category, c)
  }
  return {
    period: { id: period.id, name: period.name, startDate: period.startDate, endDate: period.endDate, status: period.status },
    categories: [...categories.values()].map((c) => ({ ...c, estimate: Object.fromEntries(Object.entries(c.estimate).map(([k, v]) => [k, v.toString()])) })),
  }
}

// Every factor a set of outcomes relied on: the main factor and any listed in the selection (CH4/N2O, GWPs, instruments).
export function factorsUsed(outcomes: Array<{ factor?: { id: string } | null; selection?: unknown }>) {
  const ids = new Set<string>()
  const codes = new Set<string>()
  for (const o of outcomes) {
    if (o.factor) ids.add(o.factor.id)
    const s = (o.selection ?? {}) as Record<string, unknown>
    for (const k of ['factorCode', 'residualFactorCode', 'instrumentFactorCode']) if (typeof s[k] === 'string') codes.add(s[k] as string)
    for (const group of ['factors', 'gwp']) {
      const g = (s[group] ?? {}) as Record<string, unknown>
      if (typeof g.code === 'string') codes.add(g.code)
      for (const v of Object.values(g)) if (typeof (v as { code?: unknown })?.code === 'string') codes.add((v as { code: string }).code)
    }
  }
  return { ids: [...ids], codes: [...codes] }
}
