// Emissions report for one reporting period: the final run when the period is locked, else the latest run
// (provisional). Totals are re-summed from the stored unrounded results and rounded once, for display or
// export only (tab 08 R-04 to R-06, R-09). Lines are never added together (tab 09 G-03 to G-07).
import { factorLabel } from '../calc/core/factorRules.js'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma } from '../../generated/prisma/client.js'
import { orgId } from '../auth/session.js'
import { dec, ZERO, type Dec } from '../calc/core/decimal.js'
import { LINES, type Issue, type ReportingLine } from '../calc/core/types.js'
import { methodByCode } from '../calc/registry.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'
import { assertPeriodVisible, isVerifier } from '../services/verifierScope.js'

type TotalKey = ReportingLine | 'BIOGENIC_MEMO' | 'S1_S2_LOCATION' | 'S1_S2_MARKET'
export const LINE_LABELS: Record<TotalKey, string> = {
  SCOPE1: 'Scope 1, direct emissions',
  SCOPE2_LOCATION: 'Scope 2 electricity, location-based',
  SCOPE2_MARKET: 'Scope 2 electricity, market-based',
  SCOPE2_HEAT: 'Scope 2 steam, heat and cooling',
  S1_S2_LOCATION: 'Scope 1 + 2, location-based',
  S1_S2_MARKET: 'Scope 1 + 2, market-based',
  BIOGENIC_MEMO: 'Biogenic CO₂ (not in totals)',
  REMOVALS: 'Carbon removals (not in totals)',
}
const SCOPE_LINES: Record<string, ReportingLine[]> = { all: LINES, '1': ['SCOPE1', 'REMOVALS'], '2': ['SCOPE2_LOCATION', 'SCOPE2_MARKET', 'SCOPE2_HEAT'] }

// G-07 / C-22: Scope 1 + 2 shown twice, once per electricity method, never mixed. Steam, heat and cooling
// (supplier factors, no location/market split) are in both. Biogenic CO2 and removals are never added.
function combined(t: Record<string, { gross: string; counted: string | null }>) {
  const add = (a: string, b: string, c: string, k: 'gross' | 'counted') =>
    [t[a]?.[k], t[b]?.[k], t[c]?.[k]].some((v) => v == null) ? null : dec(t[a][k]!).add(dec(t[b][k]!)).add(dec(t[c][k]!)).toString()
  const both = (line: string) => ({ gross: add('SCOPE1', line, 'SCOPE2_HEAT', 'gross')!, counted: add('SCOPE1', line, 'SCOPE2_HEAT', 'counted') })
  return { S1_S2_LOCATION: both('SCOPE2_LOCATION'), S1_S2_MARKET: both('SCOPE2_MARKET') }
}

const reportQuery = z.object({
  reportingPeriodId: z.uuid('Select a reporting period'),
  facilityId: z.uuid().optional(),
  scope: z.enum(['all', '1', '2']).default('all'),
  // Optional activity date range: only records whose dates overlap it are included.
  from: z.iso.date().optional(),
  to: z.iso.date().optional(),
  format: z.enum(['json', 'csv']).default('json'),
})

// Tab 08: records 3 dp (R-04), sites 2 dp (R-05), organisation 0 dp above 1,000 t else 2 (R-06).
export const round = {
  record: (d: Dec) => d.toFixed(3),
  site: (d: Dec) => d.toFixed(2),
  org: (d: Dec) => d.abs().gt(1000) ? d.toFixed(0) : d.toFixed(2),
}

type Total = { gross: Dec; counted: Dec | null }
function total(rows: Array<{ value: Dec | null; pct: Dec | null }>): Total {
  const ok = rows.filter((r) => r.value != null)
  return {
    gross: ok.reduce((s, r) => s.add(r.value!), ZERO),
    counted: ok.every((r) => r.pct != null) ? ok.reduce((s, r) => s.add(r.value!.mul(r.pct!).div(100)), ZERO) : null,
  }
}
const str = (t: Total) => ({ gross: t.gross.toString(), counted: t.counted?.toString() ?? null })

export async function buildReport(db: ReturnType<typeof getPrisma>, organizationId: string, q: z.infer<typeof reportQuery>) {
  const period = await db.reportingPeriod.findFirst({ where: { id: q.reportingPeriodId, organizationId } })
  if (!period) throw new HttpError(404, 'Reporting period not found')
  const final = period.status === 'LOCKED' && !!period.finalRunId
  const run = final
    ? await db.calculationRun.findUnique({ where: { id: period.finalRunId! }, include: { runBy: { select: { name: true } } } })
    : await db.calculationRun.findFirst({ where: { organizationId, reportingPeriodId: period.id }, orderBy: { createdAt: 'desc' }, include: { runBy: { select: { name: true } } } })
  if (!run) throw new HttpError(404, 'No calculation run for this period yet. Run the calculation first.')
  const lines = SCOPE_LINES[q.scope]

  const [organization, boundary, results] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true, legalName: true } }),
    run.boundaryId ? db.orgBoundary.findUnique({ where: { id: run.boundaryId }, select: { version: true, approach: true, effectiveFrom: true } }) : null,
    db.calculationResult.findMany({
      where: {
        runId: run.id, line: { in: lines }, ...(q.facilityId ? { facilityId: q.facilityId } : {}),
        ...(q.from || q.to ? { activityRecord: { ...(q.from ? { endDate: { gte: new Date(q.from) } } : {}), ...(q.to ? { startDate: { lte: new Date(q.to) } } : {}) } } : {}),
      },
      include: {
        facility: { select: { id: true, name: true, code: true } },
        activityRecord: { select: { id: true, startDate: true, endDate: true, quantity: true, unit: true, emissionSource: { select: { name: true, activityCode: true } } } },
        confirmedBy: { select: { name: true } },
      },
      orderBy: [{ facility: { name: 'asc' } }, { activityRecord: { startDate: 'asc' } }, { formulaCode: 'asc' }, { id: 'asc' }],
    }),
  ])
  const calculated = results.filter((r) => r.status === 'CALCULATED')
  const val = (r: (typeof results)[number]) => ({ value: r.tCO2e ? dec(r.tCO2e) : null, pct: r.inclusionPct ? dec(r.inclusionPct) : null })
  const bio = (r: (typeof results)[number]) => ({ value: r.biogenicTCO2 ? dec(r.biogenicTCO2) : null, pct: r.inclusionPct ? dec(r.inclusionPct) : null })
  const totalsFor = (rows: typeof results) => ({
    ...Object.fromEntries(lines.map((line) => [line, str(total(rows.filter((r) => r.line === line).map(val)))])),
    ...(lines.includes('SCOPE1') ? { BIOGENIC_MEMO: str(total(rows.filter((r) => r.line === 'SCOPE1').map(bio))) } : {}),
  }) as Record<string, { gross: string; counted: string | null }>

  const facilityIds = [...new Set(calculated.map((r) => r.facilityId))]
  const facilities = facilityIds.map((id) => {
    const rows = calculated.filter((r) => r.facilityId === id)
    return { facility: rows[0].facility, shares: Object.fromEntries(lines.map((l) => [l, rows.find((r) => r.line === l)?.inclusionPct?.toString() ?? null])), totals: totalsFor(rows) }
  })

  // G-11: per-gas masses for Scope 1, kept apart from CO2e; biogenic CO2 separately.
  const gases: Record<string, Dec> = {}
  for (const r of calculated) {
    for (const [gas, kg] of Object.entries((r.gases ?? {}) as Record<string, string>)) {
      const key = gas === 'CO2' && r.biogenicTCO2 != null ? 'CO2 (biogenic)' : gas
      gases[key] = (gases[key] ?? ZERO).add(dec(kg))
    }
  }

  // Every factor and GWP behind the figures, from what each result recorded.
  const codes = new Set<string>()
  for (const r of results) {
    const s = (r.selection ?? {}) as Record<string, unknown>
    for (const k of ['factorCode', 'residualFactorCode', 'instrumentFactorCode']) if (typeof s[k] === 'string') codes.add(s[k] as string)
    for (const group of ['factors', 'gwp']) {
      const g = (s[group] ?? {}) as Record<string, unknown>
      if (typeof g.code === 'string') codes.add(g.code) // { code, value } (C-05)
      for (const f of Object.values(g)) if (typeof (f as { code?: unknown })?.code === 'string') codes.add((f as { code: string }).code) // { CH4: { code } } (C-01)
    }
  }
  const factors = await db.emissionFactor.findMany({
    where: { code: { in: [...codes] } }, orderBy: { code: 'asc' },
    select: { code: true, activityCode: true, gas: true, value: true, numeratorUnit: true, denominatorUnit: true, source: true, sourceVersion: true, tier: true, validFrom: true, validTo: true, gwpSet: true, status: true, organizationId: true },
  })

  const formulas = [...new Set(results.map((r) => r.formulaCode))].sort()
  const record = (r: (typeof results)[number]) => ({
    resultId: r.id, recordId: r.activityRecordId, facility: r.facility.name, source: r.activityRecord.emissionSource.name,
    activityCode: (r.inputs as Record<string, unknown>).activityCode ?? r.activityRecord.emissionSource.activityCode,
    startDate: r.activityRecord.startDate, endDate: r.activityRecord.endDate, quantity: r.activityRecord.quantity.toString(), unit: r.activityRecord.unit,
    formulaCode: r.formulaCode, line: r.line, status: r.status, tCO2e: r.tCO2e?.toString() ?? null, biogenicTCO2: r.biogenicTCO2?.toString() ?? null,
    inclusionPct: r.inclusionPct?.toString() ?? null, issues: r.issues as unknown as Issue[],
    confirmedBy: r.confirmedBy?.name ?? null, confirmedAt: r.confirmedAt, confirmationReason: r.confirmationReason,
    // The record's own CO2 factor, when it replaced the library default for CO2.
    ownCO2Factor: (r.inputs as Record<string, unknown>).co2FactorUsed ? `${(r.inputs as Record<string, unknown>).co2FactorUsed} kg CO2/TJ${(r.inputs as Record<string, unknown>).co2FactorSource ? ` (${(r.inputs as Record<string, unknown>).co2FactorSource})` : ''}` : null,
  })

  return {
    organization,
    period: { id: period.id, name: period.name, startDate: period.startDate, endDate: period.endDate, status: period.status, lockedAt: period.lockedAt },
    status: final ? 'FINAL' as const : 'PROVISIONAL' as const,
    run: { id: run.id, createdAt: run.createdAt, runBy: run.runBy.name, engineVersion: run.engineVersion, notCalculableCount: run.notCalculableCount },
    filter: { facilityId: q.facilityId ?? null, scope: q.scope, from: q.from ?? null, to: q.to ?? null },
    boundary,
    gwpSet: run.gwpSet,
    gwpBasis: run.gwpBasis,
    gwpReason: run.gwpReason,
    lineLabels: LINE_LABELS,
    totals: q.scope === 'all' ? { ...totalsFor(calculated), ...combined(totalsFor(calculated)) } : totalsFor(calculated),
    facilities,
    gases: Object.fromEntries(Object.entries(gases).map(([k, v]) => [k, v.toString()])),
    methodology: formulas.map((code) => ({ formulaCode: code, title: methodByCode(code)?.title ?? code })),
    factors: factors.map((f) => ({ ...f, value: f.value.toString() })),
    blocked: results.filter((r) => r.status === 'BLOCKED').map(record),
    warnings: calculated.filter((r) => (r.issues as unknown as Issue[]).length > 0).map(record),
    records: results.map(record),
  }
}
type Report = Awaited<ReturnType<typeof buildReport>>

const cell = (v: unknown) => {
  const s = v == null ? '' : v instanceof Date ? v.toISOString().slice(0, 10) : String(v)
  const safe = typeof v === 'string' && /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s) ? `'${s}` : s // a cell starting with = + - @ would run as a spreadsheet formula
  return /[",\n]/.test(safe) ? `"${safe.replace(/"/g, '""')}"` : safe
}
const fmt = (v: string | null, r: (d: Dec) => string) => (v == null ? '' : r(dec(v)))

// R-09: every figure rounded once from the stored value, units on every number, and a note that rounded
// components may not add up visibly. The record lines also carry the stored unrounded value for recomputation.
export function toCsv(rep: Report): string {
  const rows: unknown[][] = [
    ['Emissions report', rep.organization.legalName ?? rep.organization.name],
    ['Reporting period', `${rep.period.name} (${cell(rep.period.startDate)} to ${cell(rep.period.endDate)})`],
    ['Status', rep.status === 'FINAL' ? `FINAL (period locked ${cell(rep.period.lockedAt)})` : 'PROVISIONAL (period not locked; figures may change)'],
    ['Calculation run', `${rep.run.id} on ${rep.run.createdAt.toISOString()} by ${rep.run.runBy}, method ${rep.run.engineVersion.replace(/^TC-DOM-\S+\s*/, 'Tula Carbon method ')}`],
    ['Boundary', rep.boundary ? `version ${rep.boundary.version}, ${rep.boundary.approach.toLowerCase()} approach` : 'no approved boundary in force at the period start: counted totals unavailable'],
    ['GWP set', `${rep.gwpSet} (${rep.gwpBasis})${rep.gwpReason ? `: ${rep.gwpReason}` : ''}`],
    ['Filter', `scope ${rep.filter.scope}${rep.filter.facilityId ? `, one facility` : ''}${rep.filter.from || rep.filter.to ? `, activity dates ${rep.filter.from ?? 'start'} to ${rep.filter.to ?? 'end'}` : ''}`],
    [],
    ['Totals', 'Gross (tCO2e)', 'Counted under boundary (tCO2e)'],
    ...Object.entries(rep.totals).map(([line, t]) => [LINE_LABELS[line as keyof typeof LINE_LABELS], fmt(t.gross, round.org), fmt(t.counted, round.org)]),
    [],
    ['By facility', 'Line', 'Gross (tCO2e)', 'Share counted (%)', 'Counted (tCO2e)'],
    ...rep.facilities.flatMap((f) => Object.entries(f.totals).map(([line, t]) => [f.facility.name, line, fmt(t.gross, round.site), f.shares[line as ReportingLine] ?? (line === 'BIOGENIC_MEMO' ? f.shares.SCOPE1 : ''), fmt(t.counted, round.site)])),
    [],
    ['Scope 1 by gas', 'Mass (kg)'],
    ...Object.entries(rep.gases).map(([gas, kg]) => [gas, dec(kg).toFixed(3)]),
    [],
    ['Records', 'Facility', 'Source', 'Activity', 'From', 'To', 'Quantity', 'Unit', 'Formula', 'Line', 'Status', 'tCO2e', 'tCO2e (stored, unrounded)', 'Biogenic tCO2', 'Share counted (%)', 'Issues', 'Own CO2 factor applied', 'Confirmed by', 'Confirmed at', 'Confirmation reason'],
    ...rep.records.map((r) => [r.recordId, r.facility, r.source, r.activityCode, r.startDate, r.endDate, r.quantity, r.unit, r.formulaCode, r.line, r.status, fmt(r.tCO2e, round.record), r.tCO2e, fmt(r.biogenicTCO2, round.record), r.inclusionPct, r.issues.map((i) => `${i.code}: ${i.message}`).join(' | '), r.ownCO2Factor, r.confirmedBy, r.confirmedAt?.toISOString() ?? null, r.confirmationReason]),
    [],
    ['Factors used', 'Activity', 'Gas', 'Value', 'Unit', 'Source', 'Version', 'Tier', 'Valid from', 'Valid to', 'GWP set', 'Library', 'Status now'],
    ...rep.factors.map((f) => [f.code, f.activityCode ?? 'all', f.gas, f.value, `${f.numeratorUnit} per ${f.denominatorUnit}`, f.source, f.sourceVersion, f.tier, f.validFrom, f.validTo ?? 'open-ended', f.gwpSet ?? '', factorLabel(f), f.status.replace('_', ' ').toLowerCase()]),
    [],
    ['Methodology', 'Tula Carbon calculation methodology (TC-DOM-002a)'],
    ...rep.methodology.map((m) => [m.formulaCode, m.title]),
    [],
    ['Notes'],
    ['Figures are stored unrounded and rounded once here: records 3 dp, facilities 2 dp, totals 0 dp above 1,000 t else 2 dp. Rounded components may not add up visibly to the totals.'],
    ['Location-based and market-based Scope 2 are alternative views and are not combined; Scope 1 + 2 is shown for each. Biogenic CO2 and carbon removals are reported separately and are not included in scope totals.'],
    ...(rep.blocked.length ? [[`${rep.blocked.length} result(s) were blocked and are not in the totals.`]] : []),
    ...(rep.run.notCalculableCount ? [[`${rep.run.notCalculableCount} approved record(s) have no calculation method yet and are not in the totals.`]] : []),
  ]
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n'
}

export const getReport: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const q = reportQuery.parse(req.query)
  await assertPeriodVisible(req, q.reportingPeriodId)
  const report = await buildReport(getPrisma(), organizationId, q)
  if (q.format === 'csv' || isVerifier(req)) {
    const after: Prisma.InputJsonValue = { reportingPeriodId: q.reportingPeriodId, runId: report.run.id, status: report.status, format: q.format }
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: q.format === 'csv' ? 'report.exported' : 'verifier.report_viewed', entityType: 'ReportingPeriod', entityId: q.reportingPeriodId, after })
  }
  if (q.format === 'json') return void res.json(report)
  const name = `emissions-${report.period.name.replace(/[^\w.-]+/g, '_')}-${report.status.toLowerCase()}.csv`
  res.setHeader('Content-Type', 'text/csv; charset=utf-8')
  res.setHeader('Content-Disposition', `attachment; filename="${name}"`)
  res.send('﻿' + toCsv(report)) // BOM so spreadsheet apps read the UTF-8 (em dashes, ³)
}
