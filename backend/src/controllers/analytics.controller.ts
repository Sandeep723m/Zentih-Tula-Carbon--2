// Analytics: the figures behind the charts, from stored calculation results only (no new calculation).
// Each period is represented by its final run when locked, else its latest run. Scope 2 location- and
// market-based stay separate series; nothing here adds them together (tab 09 G-07).
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { orgId } from '../auth/session.js'
import { dec, ZERO, type Dec } from '../calc/core/decimal.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { grantedPeriods } from '../services/verifierScope.js'

type Sums = Record<string, Dec>
const add = (s: Sums, k: string, v: Dec) => { s[k] = (s[k] ?? ZERO).add(v) }
const out = (s: Sums) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, v.toString()]))
const monthKey = (y: number, m: number) => `${y}-${String(m + 1).padStart(2, '0')}`
const DAY = 86_400_000

// A record's figure spread over the months it covers, in proportion to days (display only: a bill that
// covers six months shows up across those six months).
function byMonth(start: Date, end: Date, value: Dec, into: Record<string, Sums>, line: string) {
  const days = (end.getTime() - start.getTime()) / DAY + 1
  let y = start.getUTCFullYear(), m = start.getUTCMonth()
  while (Date.UTC(y, m, 1) <= end.getTime()) {
    const from = Math.max(Date.UTC(y, m, 1), start.getTime())
    const to = Math.min(Date.UTC(y, m + 1, 0), end.getTime())
    add((into[monthKey(y, m)] ??= {}), line, value.mul((to - from) / DAY + 1).div(days))
    m += 1; if (m === 12) { m = 0; y += 1 }
  }
}

export const getAnalytics: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const q = z.object({ reportingPeriodId: z.uuid().optional() }).parse(req.query)
  const db = getPrisma()
  const granted = await grantedPeriods(req)
  const periodRows = await db.reportingPeriod.findMany({
    where: { organizationId, ...(granted ? { id: { in: granted } } : {}) },
    orderBy: { startDate: 'asc' },
    include: { calculationRuns: { orderBy: { createdAt: 'desc' }, take: 1, select: { id: true, createdAt: true, totals: true, gwpSet: true, boundaryId: true } } },
  })
  // Final run of a locked period, else its latest.
  const finals = await db.calculationRun.findMany({ where: { id: { in: periodRows.map((p) => p.finalRunId).filter((x): x is string => !!x) } }, select: { id: true, createdAt: true, totals: true, gwpSet: true, boundaryId: true } })
  const periods = periodRows.map((p) => {
    const run = (p.status === 'LOCKED' && finals.find((r) => r.id === p.finalRunId)) || p.calculationRuns[0] || null
    return { id: p.id, name: p.name, startDate: p.startDate, endDate: p.endDate, status: p.status, run: run && { id: run.id, createdAt: run.createdAt, final: run.id === p.finalRunId && p.status === 'LOCKED', gwpSet: run.gwpSet, boundary: !!run.boundaryId, totals: run.totals } }
  })
  const withRun = periods.filter((p) => p.run)
  const selected = q.reportingPeriodId ? periods.find((p) => p.id === q.reportingPeriodId) : withRun[withRun.length - 1]
  if (q.reportingPeriodId && !selected) throw new HttpError(404, 'Reporting period not found')
  if (!selected?.run) return void res.json({ periods, selected: selected ? { periodId: selected.id } : null })

  // ponytail: one pass over the run's results in memory; aggregate in SQL past ~100k results per run.
  const results = await db.calculationResult.findMany({
    where: { runId: selected.run.id, status: 'CALCULATED' },
    select: {
      line: true, tCO2e: true, biogenicTCO2: true, inclusionPct: true,
      facility: { select: { id: true, name: true } },
      activityRecord: { select: { startDate: true, endDate: true, emissionSource: { select: { id: true, name: true, category: true } } } },
    },
  })
  const byCategory: Record<string, Sums> = {}
  const byFacility: Record<string, { name: string; gross: Sums; counted: Sums }> = {}
  const bySource: Record<string, { name: string; facility: string; category: string; lines: Sums }> = {}
  const monthly: Record<string, Sums> = {}
  for (const r of results) {
    if (!r.tCO2e) continue
    const v = dec(r.tCO2e)
    const s = r.activityRecord.emissionSource
    add((byCategory[s.category] ??= {}), r.line, v)
    const f = (byFacility[r.facility.id] ??= { name: r.facility.name, gross: {}, counted: {} })
    add(f.gross, r.line, v)
    if (r.inclusionPct != null) add(f.counted, r.line, v.mul(dec(r.inclusionPct)).div(100))
    add((bySource[s.id] ??= { name: s.name, facility: r.facility.name, category: s.category, lines: {} }).lines, r.line, v)
    byMonth(r.activityRecord.startDate, r.activityRecord.endDate, v, monthly, r.line)
    if (r.biogenicTCO2) add(byCategory[s.category], 'BIOGENIC_MEMO', dec(r.biogenicTCO2))
  }
  res.json({
    periods,
    selected: {
      periodId: selected.id, runId: selected.run.id,
      byCategory: Object.entries(byCategory).map(([category, l]) => ({ category, lines: out(l) })),
      byFacility: Object.entries(byFacility).map(([id, f]) => ({ id, name: f.name, gross: out(f.gross), counted: out(f.counted) })),
      bySource: Object.entries(bySource).map(([id, x]) => ({ id, name: x.name, facility: x.facility, category: x.category, lines: out(x.lines) })),
      monthly: Object.keys(monthly).sort().map((month) => ({ month, lines: out(monthly[month]) })),
    },
  })
}
