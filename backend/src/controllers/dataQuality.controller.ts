import type { RequestHandler } from 'express'
import { z } from 'zod'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'
import { findingsFor, type Finding } from '../services/dataQuality.js'

export const FINDINGS_PAGE_SIZE = 50
const SEVERITY_ORDER = { high: 0, medium: 1, low: 2 } as const

export const qualityQuerySchema = z.object({
  reportingPeriodId: z.uuid().optional(),
  facilityId: z.uuid().optional(),
  scope: z.enum(['1', '2']).optional(),
  category: z.string().max(40).optional(),
  severity: z.enum(['high', 'medium', 'low']).optional(),
  type: z.string().max(40).optional(),
  state: z.enum(['open', 'reviewed', 'all']).default('open'),
  recordStatus: z.enum(['DRAFT', 'SUBMITTED', 'RETURNED', 'APPROVED']).optional(),
  page: z.coerce.number().int().positive().default(1),
})

// The dashboard: counts for the whole period, findings filtered and paged.
export const getDataQuality: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const q = qualityQuerySchema.safeParse(req.query)
  if (!q.success) throw new HttpError(400, 'Invalid filter')
  const f = q.data
  const periodId = f.reportingPeriodId ?? (await getPrisma().reportingPeriod.findFirst({ where: { organizationId }, orderBy: [{ status: 'asc' }, { endDate: 'desc' }], select: { id: true } }))?.id
  if (!periodId) return void res.json({ period: null, counts: null, summary: null, byFacility: [], byCategory: [], rows: [], total: 0, page: 1, pageSize: FINDINGS_PAGE_SIZE })
  const { period, settings, counts, findings } = await findingsFor(organizationId, periodId).catch(() => { throw new HttpError(404, 'Reporting period not found') })

  const open = findings.filter((x) => !x.review)
  const tally = (key: (x: Finding) => string | null) => {
    const m = new Map<string, { key: string; open: number; high: number }>()
    for (const x of open) { const k = key(x); if (!k) continue; const e = m.get(k) ?? { key: k, open: 0, high: 0 }; e.open += 1; if (x.severity === 'high') e.high += 1; m.set(k, e) }
    return [...m.values()].sort((a, b) => b.high - a.high || b.open - a.open)
  }
  const matches = findings.filter((x) =>
    (f.state === 'all' || (f.state === 'open' ? !x.review : !!x.review))
    && (!f.facilityId || x.facilityId === f.facilityId) && (!f.scope || String(x.scope) === f.scope)
    && (!f.category || x.category === f.category) && (!f.severity || x.severity === f.severity)
    && (!f.type || x.type === f.type) && (!f.recordStatus || x.recordStatus === f.recordStatus))
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] || a.key.localeCompare(b.key))
  const count = (t: Finding['type'][]) => open.filter((x) => t.includes(x.type)).length
  res.json({
    period, settings,
    counts: { ...counts, duplicates: count(['DUPLICATE_ENTRY', 'DUPLICATE_INVOICE']), anomalies: count(['ANOMALY']), gaps: count(['MISSING_MONTH', 'NO_RECORDS', 'NO_SOURCES']), open: open.length, reviewed: findings.length - open.length },
    byFacility: tally((x) => x.facilityName), byCategory: tally((x) => x.category),
    rows: matches.slice((f.page - 1) * FINDINGS_PAGE_SIZE, f.page * FINDINGS_PAGE_SIZE), total: matches.length, page: f.page, pageSize: FINDINGS_PAGE_SIZE,
  })
}

export const reviewSchema = z.object({ findingKey: z.string().min(3).max(190), note: z.string().trim().min(1, 'Say why no change is needed').max(190) })

// "No change needed": stored against the finding's key, so it stays dismissed while the data says the same thing.
export const reviewFinding: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const { findingKey, note } = req.body as z.infer<typeof reviewSchema>
  await getPrisma().$transaction(async (tx) => {
    await tx.dataQualityReview.upsert({ where: { organizationId_findingKey: { organizationId, findingKey } }, create: { organizationId, findingKey, note, reviewedById: req.auth!.userId }, update: { note, reviewedById: req.auth!.userId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'quality.finding_reviewed', entityType: 'DataQualityFinding', entityId: findingKey, after: { note } }, tx)
  })
  res.status(204).end()
}

export const reopenFinding: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const findingKey = String(req.query.key ?? '')
  const deleted = await getPrisma().$transaction(async (tx) => {
    const r = await tx.dataQualityReview.deleteMany({ where: { organizationId, findingKey } })
    if (r.count) await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'quality.finding_reopened', entityType: 'DataQualityFinding', entityId: findingKey }, tx)
    return r.count
  })
  if (!deleted) throw new HttpError(404, 'Finding not found')
  res.status(204).end()
}
