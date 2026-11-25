// Carbon intelligence: reduction ideas, what-if scenarios, intensity and targets, all worked out from a period's
// calculated results. Nothing here writes to activity data, runs or reports, and every projection is labelled as such.
import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { SourceCategory } from '../../generated/prisma/client.js'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'

type Line = 'SCOPE1' | 'SCOPE2_LOCATION' | 'SCOPE2_MARKET' | 'SCOPE2_HEAT' | 'REMOVALS'
interface Row { facilityId: string; facility: string; sourceId: string; source: string; category: SourceCategory; activityCode: string | null; line: Line; t: number }
// Location-based Scope 1 + 2 is the headline figure; market-based is shown beside it, never added to it.
const HEADLINE: Line[] = ['SCOPE1', 'SCOPE2_LOCATION', 'SCOPE2_HEAT']
const SCOPE_LINES: Record<string, Line[]> = { ALL: HEADLINE, SCOPE1: ['SCOPE1'], SCOPE2: ['SCOPE2_LOCATION', 'SCOPE2_HEAT'] }
const round = (n: number) => Math.round(n * 1000) / 1000

// The run whose figures count for a period: the one it was locked on, else the latest.
async function periodRows(organizationId: string, periodId: string) {
  const db = getPrisma()
  const period = await db.reportingPeriod.findFirst({ where: { id: periodId, organizationId }, select: { id: true, name: true, startDate: true, finalRunId: true } })
  if (!period) throw new HttpError(404, 'Reporting period not found')
  const run = period.finalRunId
    ? await db.calculationRun.findUnique({ where: { id: period.finalRunId }, select: { id: true, createdAt: true, gwpSet: true } })
    : await db.calculationRun.findFirst({ where: { reportingPeriodId: period.id }, orderBy: { createdAt: 'desc' }, select: { id: true, createdAt: true, gwpSet: true } })
  const results = run ? await db.calculationResult.findMany({
    where: { runId: run.id, status: 'CALCULATED', tCO2e: { not: null } },
    select: { line: true, tCO2e: true, facility: { select: { id: true, code: true, name: true } }, activityRecord: { select: { emissionSource: { select: { id: true, name: true, category: true, activityCode: true } } } } },
  }) : []
  const rows: Row[] = results.map((r) => ({
    facilityId: r.facility.id, facility: `${r.facility.code} — ${r.facility.name}`, sourceId: r.activityRecord.emissionSource.id, source: r.activityRecord.emissionSource.name,
    category: r.activityRecord.emissionSource.category, activityCode: r.activityRecord.emissionSource.activityCode, line: r.line as Line, t: Number(r.tCO2e),
  }))
  return { period, run, rows }
}

const sum = (rows: Row[], lines: Line[]) => rows.filter((r) => lines.includes(r.line)).reduce((s, r) => s + r.t, 0)
function totals(rows: Row[]) {
  const by = (key: (r: Row) => string) => {
    const m = new Map<string, number>()
    for (const r of rows) if (HEADLINE.includes(r.line)) m.set(key(r), (m.get(key(r)) ?? 0) + r.t)
    return [...m.entries()].map(([k, v]) => ({ key: k, tCO2e: round(v) })).sort((a, b) => b.tCO2e - a.tCO2e)
  }
  return {
    scope1: round(sum(rows, ['SCOPE1'])), scope2Location: round(sum(rows, ['SCOPE2_LOCATION', 'SCOPE2_HEAT'])), scope2Market: round(sum(rows, ['SCOPE2_MARKET', 'SCOPE2_HEAT'])),
    headline: round(sum(rows, HEADLINE)), byFacility: by((r) => r.facility), byCategory: by((r) => r.category),
  }
}

// ---- Recommendations: fixed rules over the organisation's own results, each with its assumption stated ----
function recommendations(rows: Row[]) {
  const out: Array<{ key: string; issue: string; data: string; suggestion: string; estimatedReductionTCO2e: number; assumptions: string; limitations: string }> = []
  const scope1 = sum(rows, ['SCOPE1'])
  const bySource = new Map<string, Row[]>()
  for (const r of rows) bySource.set(r.sourceId, [...(bySource.get(r.sourceId) ?? []), r])
  for (const list of bySource.values()) {
    const r0 = list[0], t = sum(list, ['SCOPE1'])
    if (r0.category === 'FUEL_COMBUSTION' && scope1 > 0 && t / scope1 >= 0.1) {
      const mobile = /-MO-|MOBILE|ROAD/i.test(r0.activityCode ?? '')
      out.push({ key: `fuel:${r0.sourceId}`, issue: `${r0.source} at ${r0.facility} is ${Math.round((t / scope1) * 100)}% of Scope 1`,
        data: `${round(t).toLocaleString()} tCO2e from this source in the period.`,
        suggestion: mobile ? 'Review fleet efficiency: route planning, idling limits, tyre pressure and replacing the least efficient vehicles.' : 'Reduce generator or boiler running hours (grid availability, load scheduling), and check combustion efficiency and maintenance.',
        estimatedReductionTCO2e: round(t * 0.1), assumptions: 'A 10% cut in fuel used; emissions from fuel combustion scale with the quantity burned.',
        limitations: 'Estimate only. The achievable saving depends on how the equipment is used; it is not a guaranteed reduction.' })
    }
  }
  const elec = new Map<string, { loc: number; mkt: number; facility: string }>()
  for (const r of rows) if (r.category === 'PURCHASED_ELECTRICITY') {
    const e = elec.get(r.facilityId) ?? { loc: 0, mkt: 0, facility: r.facility }
    if (r.line === 'SCOPE2_LOCATION') e.loc += r.t
    if (r.line === 'SCOPE2_MARKET') e.mkt += r.t
    elec.set(r.facilityId, e)
  }
  const top = [...elec.entries()].sort((a, b) => b[1].loc - a[1].loc)[0]
  if (top && top[1].loc > 0) {
    const [id, e] = top
    out.push({ key: `elec:${id}`, issue: `${e.facility} has the highest electricity emissions`, data: `${round(e.loc).toLocaleString()} tCO2e location-based${e.mkt ? `, ${round(e.mkt).toLocaleString()} tCO2e market-based` : ''}.`,
      suggestion: 'Look for energy savings (lighting, motors, compressed air leaks, HVAC set points), and evaluate a renewable electricity contract or certificates for part of the supply.',
      estimatedReductionTCO2e: round(e.loc * 0.05), assumptions: 'A 5% efficiency saving on location-based emissions. Renewable certificates reduce only market-based emissions, and only if they meet the eligibility criteria for contractual instruments.',
      limitations: 'Estimate only; check savings with an energy audit. Location-based emissions do not change with certificates.' })
  }
  const fugitive = rows.filter((r) => r.category === 'FUGITIVE_GAS' && r.line === 'SCOPE1').reduce((s, r) => s + r.t, 0)
  if (fugitive > 0) out.push({ key: 'fugitive', issue: 'Refrigerant top-ups are adding to Scope 1', data: `${round(fugitive).toLocaleString()} tCO2e from refrigerant and gas losses.`,
    suggestion: 'Add regular leak checks, repair leaks before topping up, and prefer lower-GWP refrigerants when equipment is replaced.',
    estimatedReductionTCO2e: round(fugitive * 0.5), assumptions: 'Leaks halved by detection and repair.', limitations: 'Estimate only; actual losses vary by equipment age and servicing.' })
  return out.sort((a, b) => b.estimatedReductionTCO2e - a.estimatedReductionTCO2e)
}

// ---- Intensity -------------------------------------------------------------------------------
async function intensities(organizationId: string, periodId: string, rows: Row[]) {
  const metrics = await getPrisma().intensityMetric.findMany({ where: { organizationId, reportingPeriodId: periodId }, orderBy: [{ facilityId: 'asc' }, { metric: 'asc' }] })
  const facilityNames = new Map(rows.map((r) => [r.facilityId, r.facility]))
  return metrics.map((m) => {
    const scoped = m.facilityId ? rows.filter((r) => r.facilityId === m.facilityId) : rows
    const v = Number(m.value)
    const per = (lines: Line[]) => (v > 0 ? sum(scoped, lines) / v : null)
    return { ...m, facility: m.facilityId ? facilityNames.get(m.facilityId) ?? 'Facility with no results' : null, scope1: per(['SCOPE1']), scope2: per(['SCOPE2_LOCATION', 'SCOPE2_HEAT']), total: per(HEADLINE) }
  })
}

export const overview: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const periodId = String(req.query.reportingPeriodId ?? '')
  if (!periodId) throw new HttpError(400, 'Choose a reporting period')
  const { period, run, rows } = await periodRows(organizationId, periodId)
  res.json({ period, run, totals: totals(rows), recommendations: recommendations(rows), intensities: await intensities(organizationId, period.id, rows) })
}

// ---- What-if ---------------------------------------------------------------------------------
const adjustmentSchema = z.object({ target: z.enum(['category', 'facility', 'source']), key: z.string().min(1).max(100), percent: z.number().min(-100).max(500) })
export const simulateSchema = z.object({ reportingPeriodId: z.uuid(), adjustments: z.array(adjustmentSchema).min(1).max(20) })

// Results scale with the activity quantity for every method in the engine, so a percentage change in an activity
// changes its result by the same percentage. Factors and the GWP set stay as in the run.
function project(rows: Row[], adjustments: z.infer<typeof adjustmentSchema>[]) {
  const projected = rows.map((r) => {
    const f = adjustments.filter((a) => (a.target === 'category' ? r.category : a.target === 'facility' ? r.facilityId : r.sourceId) === a.key).reduce((m, a) => m * (1 + a.percent / 100), 1)
    return { ...r, t: r.t * f }
  })
  const before = totals(rows), after = totals(projected)
  const pct = (a: number, b: number) => (a ? ((b - a) / a) * 100 : null)
  return {
    hypothetical: true, before, after,
    reduction: round(before.headline - after.headline), reductionPercent: pct(before.headline, after.headline),
    byScope: [['Scope 1', before.scope1, after.scope1], ['Scope 2 (location-based)', before.scope2Location, after.scope2Location], ['Scope 2 (market-based)', before.scope2Market, after.scope2Market]]
      .map(([label, b, a]) => ({ label, before: b, after: a, change: round((a as number) - (b as number)) })),
    byFacility: before.byFacility.map((f) => ({ key: f.key, before: f.tCO2e, after: after.byFacility.find((x) => x.key === f.key)?.tCO2e ?? 0 })),
    byCategory: before.byCategory.map((f) => ({ key: f.key, before: f.tCO2e, after: after.byCategory.find((x) => x.key === f.key)?.tCO2e ?? 0 })),
  }
}

export const simulate: RequestHandler = async (req, res) => {
  const { reportingPeriodId, adjustments } = req.body as z.infer<typeof simulateSchema>
  const { run, rows } = await periodRows(orgId(req), reportingPeriodId)
  if (!run) throw new HttpError(409, 'Calculate this period first: scenarios start from calculated results.')
  res.json(project(rows, adjustments))
}

// What can be adjusted in a period: its categories, facilities and sources, from the results.
export const simulationOptions: RequestHandler = async (req, res) => {
  const { run, rows } = await periodRows(orgId(req), String(req.query.reportingPeriodId ?? ''))
  const uniq = (pairs: Array<[string, string]>) => [...new Map(pairs).entries()].map(([key, label]) => ({ key, label }))
  res.json({ run, categories: uniq(rows.map((r) => [r.category, r.category])), facilities: uniq(rows.map((r) => [r.facilityId, r.facility])), sources: uniq(rows.map((r) => [r.sourceId, `${r.source} (${r.facility.split(' — ')[0]})`])) })
}

export const scenarioSchema = simulateSchema.extend({ name: z.string().trim().min(1).max(120) })

export const listScenarios: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const list = await getPrisma().scenario.findMany({ where: { organizationId }, orderBy: { createdAt: 'desc' }, take: 50 })
  const cache = new Map<string, Row[]>()
  const out = []
  for (const s of list) {
    if (!cache.has(s.reportingPeriodId)) cache.set(s.reportingPeriodId, (await periodRows(organizationId, s.reportingPeriodId).catch(() => ({ rows: [] as Row[] }))).rows)
    const p = project(cache.get(s.reportingPeriodId)!, s.adjustments as z.infer<typeof adjustmentSchema>[])
    out.push({ ...s, before: p.before.headline, after: p.after.headline, reduction: p.reduction, reductionPercent: p.reductionPercent })
  }
  res.json(out)
}

export const saveScenario: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const { name, reportingPeriodId, adjustments } = req.body as z.infer<typeof scenarioSchema>
  await periodRows(organizationId, reportingPeriodId)
  const s = await getPrisma().$transaction(async (tx) => {
    const created = await tx.scenario.create({ data: { organizationId, name, reportingPeriodId, adjustments, createdById: req.auth!.userId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'scenario.saved', entityType: 'Scenario', entityId: created.id, after: { name, adjustments } }, tx)
    return created
  })
  res.status(201).json(s)
}

export const deleteScenario: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const r = await getPrisma().scenario.deleteMany({ where: { id: req.params.id as string, organizationId } })
  if (!r.count) throw new HttpError(404, 'Scenario not found')
  await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'scenario.deleted', entityType: 'Scenario', entityId: req.params.id as string })
  res.status(204).end()
}

// ---- Intensity inputs --------------------------------------------------------------------------
export const intensitySchema = z.object({
  reportingPeriodId: z.uuid(), facilityId: z.uuid().nullable().optional(),
  metric: z.enum(['EMPLOYEES', 'PRODUCTION', 'REVENUE', 'AREA', 'OUTPUT']), label: z.string().trim().min(1).max(120),
  value: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Enter a positive number'), unit: z.string().trim().min(1).max(30),
})

export const saveIntensity: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const b = req.body as z.infer<typeof intensitySchema>
  if (Number(b.value) <= 0) throw new HttpError(400, 'The denominator must be more than zero')
  const db = getPrisma()
  await periodRows(organizationId, b.reportingPeriodId)
  if (b.facilityId && !(await db.facility.findFirst({ where: { id: b.facilityId, organizationId } }))) throw new HttpError(404, 'Facility not found')
  const where = { organizationId, reportingPeriodId: b.reportingPeriodId, facilityId: b.facilityId ?? null, metric: b.metric }
  await db.$transaction(async (tx) => {
    const existing = await tx.intensityMetric.findFirst({ where })
    const data = { label: b.label, value: b.value, unit: b.unit }
    const m = existing ? await tx.intensityMetric.update({ where: { id: existing.id }, data }) : await tx.intensityMetric.create({ data: { ...where, ...data, createdById: req.auth!.userId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'intensity.saved', entityType: 'IntensityMetric', entityId: m.id, before: existing ? { value: existing.value.toString() } : undefined, after: data }, tx)
  })
  res.status(204).end()
}

export const deleteIntensity: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const r = await getPrisma().intensityMetric.deleteMany({ where: { id: req.params.id as string, organizationId } })
  if (!r.count) throw new HttpError(404, 'Measure not found')
  await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'intensity.deleted', entityType: 'IntensityMetric', entityId: req.params.id as string })
  res.status(204).end()
}

// ---- Targets --------------------------------------------------------------------------------
export const targetSchema = z.object({
  name: z.string().trim().min(1).max(120), baselinePeriodId: z.uuid(), scope: z.enum(['ALL', 'SCOPE1', 'SCOPE2']), facilityId: z.uuid().nullable().optional(),
  targetYear: z.number().int().min(2000).max(2100), reductionPercent: z.number().gt(0).max(100),
})
const baselineOf = (rows: Row[], scope: string, facilityId: string | null | undefined) => sum(facilityId ? rows.filter((r) => r.facilityId === facilityId) : rows, SCOPE_LINES[scope])

export const listTargets: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const db = getPrisma()
  const [targets, periods] = await Promise.all([
    db.carbonTarget.findMany({ where: { organizationId }, orderBy: { createdAt: 'asc' }, include: { revisions: { orderBy: { createdAt: 'asc' } } } }),
    db.reportingPeriod.findMany({ where: { organizationId }, orderBy: { startDate: 'asc' }, select: { id: true, name: true, startDate: true, endDate: true } }),
  ])
  const rowsBy = new Map<string, Row[]>()
  for (const p of periods) rowsBy.set(p.id, (await periodRows(organizationId, p.id)).rows)
  res.json(targets.map((t) => {
    const base = periods.find((p) => p.id === t.baselinePeriodId)
    const baseYear = base ? base.endDate.getUTCFullYear() : t.targetYear
    const baseline = Number(t.baselineTCO2e), goal = baseline * (1 - Number(t.reductionPercent) / 100)
    // Straight-line path from the baseline year to the target year.
    const pathFor = (year: number) => (year <= baseYear ? baseline : year >= t.targetYear ? goal : baseline + ((goal - baseline) * (year - baseYear)) / (t.targetYear - baseYear))
    const progress = periods.filter((p) => !base || p.startDate >= base.startDate).map((p) => {
      const rows = rowsBy.get(p.id) ?? []
      const year = p.endDate.getUTCFullYear()
      const actual = rows.length ? baselineOf(rows, t.scope, t.facilityId) : null
      // Compared unrounded (with a hair of tolerance for decimal storage), shown rounded.
      return { periodId: p.id, period: p.name, year, actual: actual === null ? null : round(actual), path: round(pathFor(year)), onTrack: actual === null ? null : actual <= pathFor(year) + 1e-6 }
    })
    return { ...t, baselinePeriod: base?.name ?? null, goal: round(goal), progress }
  }))
}

export const createTarget: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const b = req.body as z.infer<typeof targetSchema>
  const { rows } = await periodRows(organizationId, b.baselinePeriodId)
  if (!rows.length) throw new HttpError(409, 'Calculate the baseline period first: the baseline comes from its results.')
  const baseline = baselineOf(rows, b.scope, b.facilityId)
  if (baseline <= 0) throw new HttpError(409, 'The baseline period has no emissions for this scope and facility.')
  const t = await getPrisma().$transaction(async (tx) => {
    const created = await tx.carbonTarget.create({ data: { organizationId, name: b.name, baselinePeriodId: b.baselinePeriodId, baselineTCO2e: baseline.toFixed(10), scope: b.scope, facilityId: b.facilityId ?? null, targetYear: b.targetYear, reductionPercent: b.reductionPercent, createdById: req.auth!.userId,
      revisions: { create: { previousTCO2e: null, newTCO2e: baseline.toFixed(10), reason: 'Original baseline', userId: req.auth!.userId } } } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'target.created', entityType: 'CarbonTarget', entityId: created.id, after: { ...b, baseline } }, tx)
    return created
  })
  res.status(201).json({ id: t.id })
}

export const rebaselineSchema = z.object({ reason: z.string().trim().min(3, 'Say why the baseline is recalculated').max(190) })

// Base-year recalculation (e.g. after an acquisition or a corrected error): the baseline is worked out again from
// the baseline period's current results, and the old figure stays in the revision history.
export const rebaseline: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const { reason } = req.body as z.infer<typeof rebaselineSchema>
  const db = getPrisma()
  const t = await db.carbonTarget.findFirst({ where: { id: req.params.id as string, organizationId } })
  if (!t) throw new HttpError(404, 'Target not found')
  const now = baselineOf((await periodRows(organizationId, t.baselinePeriodId)).rows, t.scope, t.facilityId)
  if (now <= 0) throw new HttpError(409, 'The baseline period has no emissions for this scope and facility.')
  await db.$transaction(async (tx) => {
    await tx.carbonTarget.update({ where: { id: t.id }, data: { baselineTCO2e: now.toFixed(10) } })
    await tx.targetBaselineRevision.create({ data: { targetId: t.id, previousTCO2e: t.baselineTCO2e, newTCO2e: now.toFixed(10), reason, userId: req.auth!.userId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'target.rebaselined', entityType: 'CarbonTarget', entityId: t.id, before: { baseline: t.baselineTCO2e.toString() }, after: { baseline: now, reason } }, tx)
  })
  res.status(204).end()
}

export const deleteTarget: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const r = await getPrisma().carbonTarget.deleteMany({ where: { id: req.params.id as string, organizationId } })
  if (!r.count) throw new HttpError(404, 'Target not found')
  await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'target.deleted', entityType: 'CarbonTarget', entityId: req.params.id as string })
  res.status(204).end()
}
