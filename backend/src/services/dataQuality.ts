// Data quality findings for one reporting period, worked out from the data every time they are asked for.
// Findings never change a record: they point a person at it. Only a reviewer's "no change needed" is stored.
import type { SourceCategory } from '../../generated/prisma/client.js'
import { getPrisma } from '../config/database.js'
import { SCOPE_OF } from '../controllers/emissionSources.controller.js'

export type Severity = 'high' | 'medium' | 'low'
export type FindingType = 'MISSING_MONTH' | 'NO_RECORDS' | 'DUPLICATE_ENTRY' | 'DUPLICATE_INVOICE' | 'MISSING_EVIDENCE' | 'INVALID_QUANTITY'
  | 'MIXED_UNITS' | 'BILL_MISMATCH' | 'NO_SOURCES' | 'ANOMALY'
export interface Finding {
  key: string; type: FindingType; severity: Severity; title: string; detail: string
  facilityId: string | null; facilityName: string | null; category: SourceCategory | null; scope: 1 | 2 | null
  recordId?: string; recordStatus?: string; documentId?: string
  review?: { note: string; reviewedById: string; createdAt: Date }
}

const DAY = 86_400_000
const day = (d: Date) => d.toISOString().slice(0, 10)
const nice = (d: Date) => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }) // shown to people
const monthKey = (d: Date) => d.toISOString().slice(0, 7)
const monthName = (key: string) => new Date(`${key}-01T00:00:00Z`).toLocaleString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
const fmt = (n: number) => n.toLocaleString('en-IN', { maximumFractionDigits: 2 })
// Categories billed every month, so a month with nothing recorded is a gap.
const MONTHLY: SourceCategory[] = ['PURCHASED_ELECTRICITY']

// Spreads a record's quantity over the calendar months it covers, in proportion to its days.
function spread(start: Date, end: Date, quantity: number, into: Map<string, number>) {
  const days = Math.round((end.getTime() - start.getTime()) / DAY) + 1
  for (let t = start.getTime(); t <= end.getTime(); t += DAY) {
    const k = monthKey(new Date(t))
    into.set(k, (into.get(k) ?? 0) + quantity / days)
  }
}

// ponytail: loads one period's records (plus two years of history for comparison) into memory; move the
// month roll-up into SQL if a single period ever holds hundreds of thousands of records.
export async function findingsFor(organizationId: string, periodId: string, now = new Date()) {
  const db = getPrisma()
  const [org, period] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { qualityAnomalyPercent: true, qualityMinHistory: true } }),
    db.reportingPeriod.findFirstOrThrow({ where: { id: periodId, organizationId } }),
  ])
  const historyFrom = new Date(period.startDate.getTime() - 730 * DAY)
  const [facilities, sources, records, history, duplicateDocs, corrections, reviews] = await Promise.all([
    db.facility.findMany({ where: { organizationId, isActive: true }, select: { id: true, code: true, name: true, emissionSources: { where: { isActive: true }, select: { id: true } } } }),
    db.emissionSource.findMany({ where: { organizationId, isActive: true }, select: { id: true, name: true, category: true, facilityId: true, defaultUnit: true } }),
    db.activityRecord.findMany({
      where: { organizationId, reportingPeriodId: periodId },
      select: { id: true, facilityId: true, emissionSourceId: true, startDate: true, endDate: true, quantity: true, unit: true, status: true, _count: { select: { evidence: true } } },
    }),
    db.activityRecord.findMany({
      where: { organizationId, startDate: { gte: historyFrom }, endDate: { lte: period.endDate } },
      select: { emissionSourceId: true, startDate: true, endDate: true, quantity: true, unit: true },
    }),
    db.intakeDocument.findMany({ where: { organizationId, duplicateOfId: { not: null }, rejectedAt: null }, select: { id: true, fileName: true, duplicateOfId: true } }),
    db.intakeCorrection.findMany({
      where: { organizationId, field: 'quantity', document: { matches: { some: { activityRecord: { reportingPeriodId: periodId } } } } },
      select: { documentId: true, invoiceIndex: true, before: true, after: true, document: { select: { fileName: true, matches: { select: { invoiceIndex: true, activityRecordId: true } } } } },
    }),
    db.dataQualityReview.findMany({ where: { organizationId } }),
  ])
  const facilityOf = new Map(facilities.map((f) => [f.id, f]))
  const sourceOf = new Map(sources.map((s) => [s.id, s]))
  const findings: Finding[] = []
  const add = (f: Omit<Finding, 'facilityName' | 'scope' | 'category'> & { category?: SourceCategory | null }) => {
    const facility = f.facilityId ? facilityOf.get(f.facilityId) : undefined
    findings.push({ ...f, category: f.category ?? null, scope: f.category ? SCOPE_OF[f.category] : null, facilityName: facility ? `${facility.code} — ${facility.name}` : null })
  }
  const recordAt = (r: (typeof records)[number]) => {
    const s = sourceOf.get(r.emissionSourceId)
    return `${s?.name ?? 'Source'}, ${nice(r.startDate)} to ${nice(r.endDate)}, ${fmt(Number(r.quantity))} ${r.unit}`
  }

  // Facilities with nothing to record against.
  for (const f of facilities) if (!f.emissionSources.length) {
    add({ key: `NO_SOURCES:${f.id}`, type: 'NO_SOURCES', severity: 'medium', title: 'Facility has no emission sources', detail: `${f.code} — ${f.name} has no active emission source, so nothing can be recorded for it.`, facilityId: f.id })
  }

  // Gaps: monthly bills with a month uncovered, and sources with nothing at all this period.
  const lastDay = new Date(Math.min(period.endDate.getTime(), now.getTime()))
  for (const s of sources) {
    const own = records.filter((r) => r.emissionSourceId === s.id)
    if (!own.length) {
      if (period.startDate <= now) add({ key: `NO_RECORDS:${s.id}:${periodId}`, type: 'NO_RECORDS', severity: MONTHLY.includes(s.category) ? 'high' : 'medium', title: 'No records for this source', detail: `${s.name} has no activity data in ${period.name}.`, facilityId: s.facilityId, category: s.category })
      continue
    }
    if (!MONTHLY.includes(s.category)) continue
    const covered = new Set<string>()
    for (const r of own) for (let t = r.startDate.getTime(); t <= r.endDate.getTime(); t += DAY) covered.add(day(new Date(t)))
    const missing = new Set<string>()
    // A month counts as missing when more than half of its days (up to today) have no record.
    const months = new Map<string, { all: number; gap: number }>()
    for (let t = period.startDate.getTime(); t <= lastDay.getTime(); t += DAY) {
      const d = new Date(t), m = months.get(monthKey(d)) ?? { all: 0, gap: 0 }
      m.all += 1; if (!covered.has(day(d))) m.gap += 1
      months.set(monthKey(d), m)
    }
    for (const [k, m] of months) if (m.gap * 2 > m.all) missing.add(k)
    for (const k of missing) add({ key: `MISSING_MONTH:${s.id}:${k}`, type: 'MISSING_MONTH', severity: 'high', title: `Missing ${monthName(k)} bill`, detail: `${s.name} has no electricity record covering most of ${monthName(k)}.`, facilityId: s.facilityId, category: s.category })
  }

  // Record-level checks.
  const sameEntry = new Map<string, typeof records>()
  const unitsBySource = new Map<string, Map<string, number>>()
  for (const r of records) {
    const s = sourceOf.get(r.emissionSourceId)
    const base = { facilityId: r.facilityId, category: s?.category ?? null, recordId: r.id, recordStatus: r.status }
    const k = `${r.facilityId}|${day(r.startDate)}|${day(r.endDate)}|${r.quantity.toString()}|${r.unit}`
    sameEntry.set(k, [...(sameEntry.get(k) ?? []), r])
    const u = unitsBySource.get(r.emissionSourceId) ?? new Map<string, number>()
    u.set(r.unit, (u.get(r.unit) ?? 0) + 1); unitsBySource.set(r.emissionSourceId, u)
    if (!r._count.evidence) add({ ...base, key: `MISSING_EVIDENCE:${r.id}`, type: 'MISSING_EVIDENCE', severity: r.status === 'DRAFT' ? 'low' : 'medium', title: 'No supporting evidence', detail: `${recordAt(r)} has no bill, invoice or log attached.` })
    if (Number(r.quantity) <= 0 && s?.category !== 'FUGITIVE_GAS') add({ ...base, key: `INVALID_QUANTITY:${r.id}`, type: 'INVALID_QUANTITY', severity: 'high', title: 'Zero quantity', detail: `${recordAt(r)} records no consumption. Check whether the bill was entered correctly.` })
  }
  for (const group of sameEntry.values()) if (group.length > 1) {
    const [first, ...rest] = group
    for (const r of rest) add({ key: `DUPLICATE_ENTRY:${first.id}:${r.id}`, type: 'DUPLICATE_ENTRY', severity: 'high', title: 'Possible duplicate entry', detail: `${recordAt(r)} has the same facility, dates and quantity as another record (${sourceOf.get(first.emissionSourceId)?.name ?? 'another source'}).`, facilityId: r.facilityId, category: sourceOf.get(r.emissionSourceId)?.category ?? null, recordId: r.id, recordStatus: r.status })
  }
  for (const [sourceId, units] of unitsBySource) if (units.size > 1) {
    const s = sourceOf.get(sourceId)
    add({ key: `MIXED_UNITS:${sourceId}:${periodId}`, type: 'MIXED_UNITS', severity: 'low', title: 'Several units used for one source', detail: `${s?.name ?? 'A source'} has records in ${[...units.keys()].join(', ')}. Check each one is converted correctly.`, facilityId: s?.facilityId ?? null, category: s?.category ?? null })
  }

  // Documents: possible duplicate invoices, and records that differ from the bill they were matched to.
  for (const d of duplicateDocs) add({ key: `DUPLICATE_INVOICE:${d.id}`, type: 'DUPLICATE_INVOICE', severity: 'medium', title: 'Possible duplicate invoice', detail: `${d.fileName} has the same supplier and invoice number as another uploaded document.`, facilityId: null, documentId: d.id })
  for (const c of corrections) {
    const recordId = c.document.matches.find((m) => m.invoiceIndex === c.invoiceIndex)?.activityRecordId
    const r = records.find((x) => x.id === recordId)
    if (!r) continue
    add({ key: `BILL_MISMATCH:${c.documentId}:${c.invoiceIndex}`, type: 'BILL_MISMATCH', severity: 'medium', title: 'Record differs from its bill', detail: `${recordAt(r)}, but ${c.document.fileName} was read as ${c.before ?? 'no quantity'}. Check which is right.`, facilityId: r.facilityId, category: sourceOf.get(r.emissionSourceId)?.category ?? null, recordId: r.id, recordStatus: r.status, documentId: c.documentId })
  }

  // Unusual months: each month against the average of the months before it, per source and unit.
  for (const s of sources) {
    const months = new Map<string, number>()
    const unit = [...(unitsBySource.get(s.id) ?? new Map()).entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? s.defaultUnit
    for (const r of history) if (r.emissionSourceId === s.id && r.unit === unit) spread(r.startDate, r.endDate, Number(r.quantity), months)
    const keys = [...months.keys()].sort()
    for (const [i, k] of keys.entries()) {
      if (k < monthKey(period.startDate) || k > monthKey(lastDay)) continue
      const before = keys.slice(0, i).slice(-org.qualityMinHistory)
      if (before.length < org.qualityMinHistory) continue
      const avg = before.reduce((t, m) => t + months.get(m)!, 0) / before.length
      const v = months.get(k)!
      const change = avg ? ((v - avg) / avg) * 100 : 0
      if (Math.abs(change) < org.qualityAnomalyPercent) continue
      add({ key: `ANOMALY:${s.id}:${k}`, type: 'ANOMALY', severity: Math.abs(change) >= org.qualityAnomalyPercent * 2 ? 'high' : 'medium', title: `Unusual ${change > 0 ? 'increase' : 'drop'} in ${monthName(k)}`,
        detail: `${s.name}: ${fmt(v)} ${unit} in ${monthName(k)} against an average of ${fmt(avg)} ${unit} over the previous ${before.length} months (${change > 0 ? '+' : ''}${Math.round(change)}%). Check the bill and the meter.`, facilityId: s.facilityId, category: s.category })
    }
  }

  const reviewed = new Map(reviews.map((r) => [r.findingKey, r]))
  for (const f of findings) {
    const r = reviewed.get(f.key)
    if (r) f.review = { note: r.note, reviewedById: r.reviewedById, createdAt: r.createdAt }
  }
  const counts = {
    records: records.length,
    complete: records.filter((r) => r._count.evidence > 0 && Number(r.quantity) > 0).length,
    missingEvidence: records.filter((r) => !r._count.evidence).length,
    pendingReview: records.filter((r) => r.status === 'SUBMITTED').length,
    returned: records.filter((r) => r.status === 'RETURNED').length,
  }
  return { period: { id: period.id, name: period.name }, settings: org, counts, findings }
}
