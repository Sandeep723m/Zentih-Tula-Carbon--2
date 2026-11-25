// The auditor workspace: readiness indicators, record sampling and the evidence pack for one reporting period.
// Verifiers see only periods granted to them, and only approved records, exactly as elsewhere.
import { factorLabel } from '../calc/core/factorRules.js'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'
import { assertPeriodVisible, isVerifier } from '../services/verifierScope.js'
import { storage } from '../storage/index.js'
import { csv, zip } from '../services/zip.js'

const day = (d: Date) => d.toISOString().slice(0, 10)

async function periodContext(req: Parameters<RequestHandler>[0], periodId: string) {
  const organizationId = orgId(req)
  await assertPeriodVisible(req, periodId)
  const db = getPrisma()
  const period = await db.reportingPeriod.findFirst({ where: { id: periodId, organizationId }, select: { id: true, name: true, status: true, finalRunId: true } })
  if (!period) throw new HttpError(404, 'Reporting period not found')
  const run = period.finalRunId ? await db.calculationRun.findUnique({ where: { id: period.finalRunId } }) : await db.calculationRun.findFirst({ where: { reportingPeriodId: periodId }, orderBy: { createdAt: 'desc' } })
  // Combined with AND, so a filter on status can only narrow a verifier's approved-only view, never widen it.
  const recordWhere = { organizationId, reportingPeriodId: periodId, AND: isVerifier(req) ? [{ status: 'APPROVED' as const }] : [] }
  return { organizationId, period, run, recordWhere, db }
}

// Separate indicators, not a score: each says what is and is not in place.
// Results stored before the labels were reworded still name internal spec sections; show the plain description.
const plainRule = (sel: unknown) => {
  const s = sel as { rule?: unknown } | null
  if (!s || typeof s.rule !== 'string') return sel
  const rule = s.rule.replace(/^Tabs? \d+ rules? \d+(?: and \d+)?( fallback)?: (.)/, (_m, fb: string | undefined, c: string) => (fb ? `Fallback: ${c}` : c.toUpperCase())).replace(/^C-\d+: (.)/, (_m, c: string) => c.toUpperCase()).replace(/\s*\([GQ]-\d+\)|,\s*[GQ]-\d+(?=\))/g, '')
  return { ...s, rule }
}

export const readiness: RequestHandler = async (req, res) => {
  const { period, run, recordWhere, db } = await periodContext(req, String(req.query.reportingPeriodId ?? ''))
  const [submitted, withEvidence, approved, awaiting, openQueries, warnings, unconfirmed] = await Promise.all([
    db.activityRecord.count({ where: { ...recordWhere, status: { in: ['SUBMITTED', 'APPROVED'] } } }),
    db.activityRecord.count({ where: { ...recordWhere, status: { in: ['SUBMITTED', 'APPROVED'] }, evidence: { some: {} } } }),
    db.activityRecord.count({ where: { ...recordWhere, status: 'APPROVED' } }),
    db.activityRecord.count({ where: { ...recordWhere, status: 'SUBMITTED' } }),
    db.activityRecord.count({ where: { ...recordWhere, queries: { some: { status: 'OPEN' } } } }),
    run ? db.calculationResult.count({ where: { runId: run.id, needsConfirmation: true } }) : 0,
    run ? db.calculationResult.count({ where: { runId: run.id, needsConfirmation: true, confirmedAt: null } }) : 0,
  ])
  res.json({ period, run: run ? { id: run.id, createdAt: run.createdAt } : null, indicators: { submitted, withEvidence, withoutEvidence: submitted - withEvidence, approved, awaiting, openQueries, warnings, unconfirmed } })
}

export const sampleSchema = z.object({
  reportingPeriodId: z.uuid(), facilityId: z.uuid().optional(), category: z.string().max(40).optional(),
  minQuantity: z.coerce.number().optional(), maxQuantity: z.coerce.number().optional(), minTCO2e: z.coerce.number().optional(),
  risk: z.enum(['missingEvidence', 'openQuery', 'warning', 'largest']).optional(), size: z.coerce.number().int().min(1).max(200).default(25),
})

// Picks records for detailed testing. "largest" takes the highest emitters; otherwise a random sample of the filtered set.
export const sample: RequestHandler = async (req, res) => {
  const q = sampleSchema.safeParse(req.query)
  if (!q.success) throw new HttpError(400, 'Invalid filter')
  const f = q.data
  const { run, recordWhere, db } = await periodContext(req, f.reportingPeriodId)
  const records = await db.activityRecord.findMany({
    where: { ...recordWhere, ...(f.facilityId ? { facilityId: f.facilityId } : {}), ...(f.category ? { emissionSource: { category: f.category as never } } : {}),
      ...(f.minQuantity !== undefined || f.maxQuantity !== undefined ? { quantity: { ...(f.minQuantity !== undefined ? { gte: f.minQuantity } : {}), ...(f.maxQuantity !== undefined ? { lte: f.maxQuantity } : {}) } } : {}),
      ...(f.risk === 'missingEvidence' ? { evidence: { none: {} } } : {}), ...(f.risk === 'openQuery' ? { queries: { some: { status: 'OPEN' } } } : {}) },
    select: { id: true, startDate: true, endDate: true, quantity: true, unit: true, status: true, facility: { select: { code: true } }, emissionSource: { select: { name: true, category: true } }, _count: { select: { evidence: true } } },
    take: 5000,
  })
  const results = run ? await db.calculationResult.findMany({ where: { runId: run.id, activityRecordId: { in: records.map((r) => r.id) } }, select: { activityRecordId: true, tCO2e: true, needsConfirmation: true } }) : []
  let rows = records.map((r) => {
    const own = results.filter((x) => x.activityRecordId === r.id)
    return { ...r, tCO2e: own.reduce((s, x) => s + Number(x.tCO2e ?? 0), 0), warning: own.some((x) => x.needsConfirmation) }
  })
  if (f.minTCO2e !== undefined) rows = rows.filter((r) => r.tCO2e >= f.minTCO2e!)
  if (f.risk === 'warning') rows = rows.filter((r) => r.warning)
  const population = rows.length
  rows = f.risk === 'largest' ? rows.sort((a, b) => b.tCO2e - a.tCO2e) : rows.map((r) => ({ r, k: Math.random() })).sort((a, b) => a.k - b.k).map((x) => x.r)
  res.json({ population, rows: rows.slice(0, f.size).map((r) => ({ ...r, startDate: day(r.startDate), endDate: day(r.endDate) })) })
}

async function readAll(key: string) {
  const chunks: Buffer[] = []
  for await (const c of storage.read(key)) chunks.push(c as Buffer)
  return Buffer.concat(chunks)
}

// Everything a verifier needs for one period, limited to what the person asking may see.
export const evidencePack: RequestHandler = async (req, res) => {
  const { organizationId, period, run, recordWhere, db } = await periodContext(req, String(req.query.reportingPeriodId ?? ''))
  const records = await db.activityRecord.findMany({ where: recordWhere, orderBy: { startDate: 'asc' },
    include: { facility: { select: { code: true, name: true } }, emissionSource: { select: { name: true, category: true, activityCode: true } }, evidence: true, reviews: { orderBy: { createdAt: 'asc' }, include: { actor: { select: { name: true } } } } } })
  const ids = records.map((r) => r.id)
  const [results, queries, audit] = await Promise.all([
    run ? db.calculationResult.findMany({ where: { runId: run.id, activityRecordId: { in: ids } }, include: { emissionFactor: true } }) : [],
    db.verificationQuery.findMany({ where: { organizationId, reportingPeriodId: period.id }, include: { messages: { orderBy: { createdAt: 'asc' } } } }),
    db.auditLog.findMany({ where: { organizationId, OR: [{ entityId: { in: ids } }, { entityId: period.id }] }, orderBy: { createdAt: 'asc' }, take: 20000 }),
  ])
  const files: Array<{ name: string; data: Buffer }> = [
    { name: 'README.txt', data: Buffer.from(`Evidence pack: ${period.name}\r\nGenerated ${new Date().toISOString()}${run ? `\r\nCalculation run ${run.id} (${run.engineVersion}, GWP ${run.gwpSet})` : '\r\nNo calculation run yet'}\r\nRecords: ${records.length}${isVerifier(req) ? ' (approved records only)' : ''}\r\n`) },
    { name: 'activity-records.csv', data: csv(records.map((r) => ({ id: r.id, facility: r.facility.code, source: r.emissionSource.name, category: r.emissionSource.category, activity: r.emissionSource.activityCode, from: day(r.startDate), to: day(r.endDate), quantity: r.quantity.toString(), unit: r.unit, parameters: r.parameters, status: r.status, notes: r.notes, evidenceFiles: r.evidence.length }))) },
    { name: 'calculations.csv', data: csv(results.map((x) => ({ recordId: x.activityRecordId, formula: x.formulaCode, line: x.line, status: x.status, inputs: x.inputs, factorCode: x.emissionFactor?.code ?? null, factorLibrary: x.emissionFactor ? factorLabel(x.emissionFactor) : null, factorValue: x.factorValue?.toString() ?? null, factorUnit: x.emissionFactor ? `${x.emissionFactor.numeratorUnit}/${x.emissionFactor.denominatorUnit}` : null, selection: plainRule(x.selection), gases: x.gases, tCO2e: x.tCO2e?.toString() ?? null, biogenicTCO2: x.biogenicTCO2?.toString() ?? null, issues: x.issues, confirmedAt: x.confirmedAt, confirmationReason: x.confirmationReason }))) },
    { name: 'emission-factors.csv', data: csv([...new Map(results.filter((x) => x.emissionFactor).map((x) => [x.emissionFactor!.id, x.emissionFactor!])).values()].map((e) => ({ code: e.code, activity: e.activityCode, gas: e.gas, value: e.value.toString(), unit: `${e.numeratorUnit}/${e.denominatorUnit}`, source: e.source, version: e.sourceVersion, validFrom: day(e.validFrom), validTo: e.validTo ? day(e.validTo) : null, region: e.regionCode, geography: e.geography, tier: e.tier }))) },
    { name: 'review-history.csv', data: csv(records.flatMap((r) => r.reviews.map((v) => ({ recordId: r.id, action: v.action, from: v.fromStatus, to: v.toStatus, by: v.actor.name, comment: v.comment, at: v.createdAt })))) },
    { name: 'verification-queries.csv', data: csv(queries.flatMap((q) => [{ queryId: q.id, recordId: q.activityRecordId, subject: q.subject, status: q.status, message: '', at: q.createdAt }, ...q.messages.map((m) => ({ queryId: q.id, recordId: q.activityRecordId, subject: '', status: '', message: m.body, at: m.createdAt }))])) },
    { name: 'audit-trail.csv', data: csv(audit.map((a) => ({ at: a.createdAt, action: a.action, entity: a.entityType, entityId: a.entityId, before: a.before, after: a.after, reason: a.reason }))) },
  ]
  for (const r of records) for (const e of r.evidence) {
    const data = await readAll(e.storageKey).catch(() => null)
    if (data) files.push({ name: `evidence/${r.facility.code}-${day(r.startDate)}-${r.id.slice(0, 8)}/${e.fileName}`, data })
  }
  await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'evidence_pack.exported', entityType: 'ReportingPeriod', entityId: period.id, after: { records: records.length, files: files.length } })
  res.setHeader('Content-Type', 'application/zip')
  res.setHeader('Content-Disposition', `attachment; filename="evidence-pack-${period.name.replace(/[^\w.-]+/g, '_')}.zip"`)
  res.setHeader('Cache-Control', 'private, no-store')
  res.end(zip(files))
}
