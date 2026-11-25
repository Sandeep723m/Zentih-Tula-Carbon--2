import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { orgId } from '../auth/session.js'
import { DOCUMENT_TYPES, type Extraction, jsonPath, processDocument, stuckBefore } from '../ai/documentReader.js'
import { AiError, aiAllowedFor, aiConfig, aiKeySet } from '../ai/index.js'
import { getPrisma } from '../config/database.js'
import { env } from '../config/env.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'
import { storage } from '../storage/index.js'
import { assertEditable } from './activities.controller.js'
import { decodeName, sanitizeFileName, TYPES } from './evidence.controller.js'

// Formats the AI provider can read directly.
export const INTAKE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.csv']
export const DOCUMENT_PAGE_SIZE = 50

const listFields = {
  id: true, fileName: true, mimeType: true, sizeBytes: true, status: true, attempts: true, errorMessage: true, documentType: true,
  activityRecordId: true, category: true, duplicateOfId: true, rejectedAt: true, rejectReason: true, createdAt: true, updatedAt: true,
  uploadedBy: { select: { name: true } },
} as const
const stageFields = { ...listFields, result: true, matches: { select: { invoiceIndex: true, activityRecord: { select: { status: true } } } } } as const

type Invoice = Partial<Extraction>
// Every invoice in the document; documents read before multi-invoice support hold one, at the top level.
export const invoicesOf = (result: unknown): Invoice[] => {
  const r = result as (Invoice & { invoices?: Invoice[] }) | null
  return !r ? [] : r.invoices?.length ? r.invoices : [r]
}
const incomplete = (i: Invoice) => !i.quantity || !i.unit || !(i.periodStart || i.activityDate) || !(i.periodEnd || i.activityDate) || (i.confidence ?? 0) < 0.6

// Where a document stands, worked out from its data so it can never disagree with it.
export function stageOf(d: { status: string; rejectedAt: Date | null; result: unknown; matches: Array<{ invoiceIndex: number; activityRecord: { status: string } }> }) {
  if (d.rejectedAt) return 'REJECTED'
  if (d.status === 'PENDING') return 'RECEIVED'
  if (d.status !== 'EXTRACTED') return d.status // PROCESSING, FAILED
  const invoices = invoicesOf(d.result)
  const open = invoices.filter((_, i) => !d.matches.some((m) => m.invoiceIndex === i))
  if (!open.length) return d.matches.every((m) => m.activityRecord.status === 'SUBMITTED' || m.activityRecord.status === 'APPROVED') ? 'SUBMITTED' : 'MATCHED'
  return open.some(incomplete) ? 'NEEDS_CORRECTION' : 'AWAITING_REVIEW'
}
const withStage = <T extends Parameters<typeof stageOf>[0]>({ result, matches, ...d }: T) => ({ ...d, stage: stageOf({ ...d, result, matches }), invoiceCount: invoicesOf(result).length })

// Reading runs after the response. Failures are recorded on the document, so nothing here can be unhandled.
const startReading = (id: string) => { void processDocument(id).catch((e: Error) => console.error('Document reading failed:', e.message)) }

// Cost guard: a runaway script or mistake cannot run up an unbounded bill.
async function assertWithinDailyLimit(organizationId: string) {
  if (!aiAllowedFor(organizationId)) throw new HttpError(403, 'Automatic document reading is switched off for your organisation. Attach the file to the activity record and enter the values by hand.')
  const since = new Date(); since.setUTCHours(0, 0, 0, 0)
  const used = await getPrisma().aiUsageEvent.count({ where: { organizationId, createdAt: { gte: since } } })
  if (used >= env.AI_DAILY_LIMIT_PER_ORG) throw new HttpError(429, 'The daily limit for automatic reading has been reached. Your existing documents are safe; please try again tomorrow.')
  // Platform-wide cap: protects the shared AI budget whatever happens across organisations.
  const all = await getPrisma().aiUsageEvent.count({ where: { createdAt: { gte: since } } })
  if (all >= env.AI_DAILY_LIMIT_PLATFORM) throw new HttpError(429, 'Automatic reading is paused for today. Your documents are saved; please try again tomorrow or enter the values by hand.')
}

const findDocument = async (id: string, organizationId: string) => {
  const d = await getPrisma().intakeDocument.findFirst({ where: { id, organizationId } })
  if (!d) throw new HttpError(404, 'Document not found')
  return d
}

export const listQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  status: z.enum(['PENDING', 'PROCESSING', 'EXTRACTED', 'FAILED']).optional(),
})

export const listDocuments: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const q = listQuerySchema.safeParse(req.query)
  if (!q.success) throw new HttpError(400, 'Invalid filter')
  const db = getPrisma()
  const where = { organizationId, ...(q.data.status ? { status: q.data.status } : {}) }
  const [rows, total, groups] = await Promise.all([
    db.intakeDocument.findMany({ where, select: stageFields, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }], skip: (q.data.page - 1) * DOCUMENT_PAGE_SIZE, take: DOCUMENT_PAGE_SIZE }),
    db.intakeDocument.count({ where }),
    db.intakeDocument.groupBy({ by: ['status'], where: { organizationId }, _count: true }),
  ])
  res.json({ rows: rows.map(withStage), total, page: q.data.page, pageSize: DOCUMENT_PAGE_SIZE, counts: Object.fromEntries(groups.map((g) => [g.status, g._count])) })
}

export const getDocument: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const db = getPrisma()
  const d = await db.intakeDocument.findFirst({ where: { id: req.params.id as string, organizationId }, select: stageFields })
  if (!d) throw new HttpError(404, 'Document not found')
  const invoices = invoicesOf(d.result)
  const recordSummary = { id: true, status: true, startDate: true, endDate: true, quantity: true, unit: true, facility: { select: { id: true, code: true, name: true } }, emissionSource: { select: { id: true, name: true } } } as const
  const [matches, corrections, duplicateOf, candidates, recurring] = await Promise.all([
    db.intakeMatch.findMany({ where: { documentId: d.id }, orderBy: { invoiceIndex: 'asc' }, select: { invoiceIndex: true, withEvidence: true, activityRecord: { select: recordSummary } } }),
    db.intakeCorrection.findMany({ where: { documentId: d.id }, orderBy: { createdAt: 'desc' }, take: 100, select: { invoiceIndex: true, field: true, before: true, after: true, createdAt: true } }),
    d.duplicateOfId ? db.intakeDocument.findFirst({ where: { id: d.duplicateOfId, organizationId }, select: { id: true, fileName: true } }) : null,
    // Existing records this invoice may already be: same quantity and overlapping dates.
    Promise.all(invoices.map((i, index) => {
      const from = i.periodStart ?? i.activityDate, to = i.periodEnd ?? i.activityDate
      if (!i.quantity || !from || !to || d.matches.some((m) => m.invoiceIndex === index)) return []
      return db.activityRecord.findMany({
        where: { organizationId, quantity: i.quantity, startDate: { lte: new Date(to) }, endDate: { gte: new Date(from) } },
        select: recordSummary, take: 5,
      })
    })),
    // A supplier seen before: its last matched record suggests the facility and source again.
    invoices[0]?.supplier ? db.intakeMatch.findFirst({
      where: { organizationId, documentId: { not: d.id }, document: { result: { path: jsonPath('supplier'), equals: invoices[0].supplier } } },
      orderBy: { createdAt: 'desc' }, select: { activityRecord: { select: { facilityId: true, emissionSourceId: true } } },
    }).catch(() => null) : null,
  ])
  const recurringCount = recurring && invoices[0]?.supplier
    ? await db.intakeDocument.count({ where: { organizationId, id: { not: d.id }, result: { path: jsonPath('supplier'), equals: invoices[0].supplier } } }).catch(() => 0)
    : 0
  res.json({ ...withStage(d), result: d.result, invoices, matches, corrections, duplicateOf, candidates,
    recurring: recurring ? { count: recurringCount, facilityId: recurring.activityRecord.facilityId, emissionSourceId: recurring.activityRecord.emissionSourceId } : null })
}

export const categorySchema = z.object({ category: z.enum(DOCUMENT_TYPES) })

// A person corrects the AI's classification; the change is kept as a correction.
export const setCategory: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const d = await findDocument(req.params.id as string, organizationId)
  const { category } = req.body as z.infer<typeof categorySchema>
  const before = d.category ?? d.documentType
  if (before === category) return void res.status(204).end()
  await getPrisma().$transaction(async (tx) => {
    await tx.intakeDocument.update({ where: { id: d.id }, data: { category } })
    await tx.intakeCorrection.create({ data: { organizationId, documentId: d.id, invoiceIndex: 0, field: 'documentType', before, after: category, userId: req.auth!.userId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'document.recategorised', entityType: 'IntakeDocument', entityId: d.id, before: { category: before }, after: { category } }, tx)
  })
  res.status(204).end()
}

export const rejectSchema = z.object({ reason: z.string().trim().max(190).nullable().optional() })

// Reject marks a document unusable (wrong file, unreadable, not ours); null reason with ?undo restores it. Nothing is deleted.
export const rejectDocument: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const d = await findDocument(req.params.id as string, organizationId)
  const undo = req.query.undo === '1'
  const { reason } = req.body as z.infer<typeof rejectSchema>
  if (!undo && !reason) throw new HttpError(400, 'Say why the document is rejected')
  await getPrisma().$transaction(async (tx) => {
    await tx.intakeDocument.update({ where: { id: d.id }, data: undo ? { rejectedAt: null, rejectReason: null } : { rejectedAt: new Date(), rejectReason: reason } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: undo ? 'document.restored' : 'document.rejected', entityType: 'IntakeDocument', entityId: d.id, after: undo ? {} : { reason } }, tx)
  })
  res.status(204).end()
}

// Body is the raw file (express.raw on the route); name comes from the X-File-Name header.
export const uploadDocument: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const db = getPrisma()
  const fileName = sanitizeFileName(decodeName(req.headers['x-file-name']))
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  const ext = path.extname(fileName).toLowerCase()
  const type = INTAKE_EXTENSIONS.includes(ext) ? TYPES[ext] : undefined
  const problem =
    !fileName || !ext ? 'File name is missing or invalid'
    : !type ? `This file type cannot be read automatically. Allowed: ${INTAKE_EXTENSIONS.join(', ')}`
    : data.length === 0 ? 'The file is empty'
    : !type.looksRight(data) ? `The file content does not match its ${ext} extension`
    : null
  if (problem) throw new HttpError(400, problem)

  const sha256 = createHash('sha256').update(data).digest('hex')
  const existing = await db.intakeDocument.findFirst({ where: { organizationId, sha256 }, select: { id: true, fileName: true } })
  if (existing) throw new HttpError(409, `This file was already uploaded as "${existing.fileName}".`)
  await assertWithinDailyLimit(organizationId)

  // File first, then the row; if the row fails, remove the file so nothing is orphaned.
  const storageKey = `${organizationId}/${randomUUID()}`
  await storage.put(storageKey, data)
  try {
    const doc = await db.$transaction(async (tx) => {
      const d = await tx.intakeDocument.create({
        data: { organizationId, fileName, mimeType: type!.mime, sizeBytes: data.length, sha256, storageKey, uploadedById: userId },
        select: listFields,
      })
      await writeAudit({ organizationId, actorUserId: userId, action: 'document.uploaded', entityType: 'IntakeDocument', entityId: d.id, after: { fileName, sizeBytes: data.length, sha256 } }, tx)
      return d
    })
    startReading(doc.id)
    res.status(201).json(doc)
  } catch (e) {
    await storage.remove(storageKey).catch(() => {})
    throw e
  }
}

export const retryDocument: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const d = await findDocument(req.params.id as string, organizationId)
  const stuck = d.status === 'PENDING' || (d.status === 'PROCESSING' && d.updatedAt < stuckBefore())
  if (d.status !== 'FAILED' && !stuck) throw new HttpError(409, d.status === 'EXTRACTED' ? 'This document has already been read.' : 'This document is still being read.')
  await assertWithinDailyLimit(organizationId)
  startReading(d.id)
  res.status(202).json({ id: d.id })
}

export const linkSchema = z.object({ activityRecordId: z.uuid(), invoiceIndex: z.number().int().min(0).max(19).default(0) })

// Bills spell units many ways; corrections compare them by these codes.
const UNIT_ALIASES: Record<string, string> = { ltr: 'l', ltrs: 'l', litre: 'l', litres: 'l', liter: 'l', liters: 'l', units: 'kwh', kgs: 'kg', mt: 't', tonne: 't', tonnes: 't', ton: 't', tons: 't' }
const unitKey = (u: string | null | undefined) => { const k = (u ?? '').trim().toLowerCase(); return UNIT_ALIASES[k] ?? k }
const day = (d: Date) => d.toISOString().slice(0, 10)

// Matches one invoice in the document to a record. A record that can still change gets the file as evidence;
// an approved or locked one is matched without touching it.
export const linkDocument: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const db = getPrisma()
  const { activityRecordId, invoiceIndex } = req.body as z.infer<typeof linkSchema>
  const d = await findDocument(req.params.id as string, organizationId)
  const invoices = invoicesOf(d.result)
  if (d.status === 'EXTRACTED' && invoiceIndex >= invoices.length) throw new HttpError(400, 'That invoice is not in this document.')
  if (await db.intakeMatch.findUnique({ where: { documentId_invoiceIndex: { documentId: d.id, invoiceIndex } } })) throw new HttpError(409, 'This invoice is already matched to a record.')
  const record = await db.activityRecord.findFirst({ where: { id: activityRecordId, organizationId }, include: { reportingPeriod: { select: { status: true, name: true } } } })
  if (!record) throw new HttpError(404, 'Record not found')
  let editable = true
  try { assertEditable(record, req.auth!) } catch { editable = false }

  // What the person changed from what was read: kept so reading quality can be measured.
  const inv = invoices[invoiceIndex]
  const corrections = !inv ? [] : ([
    ['quantity', inv.quantity, record.quantity.toString(), (a: string, b: string) => Number(a) === Number(b)],
    ['unit', inv.unit, record.unit, (a: string, b: string) => unitKey(a) === unitKey(b)],
    ['startDate', inv.periodStart ?? inv.activityDate, day(record.startDate), (a: string, b: string) => a === b],
    ['endDate', inv.periodEnd ?? inv.activityDate, day(record.endDate), (a: string, b: string) => a === b],
  ] as const).filter(([, before, after, same]) => !before || !same(before, after)).map(([field, before, after]) => ({ field, before: before ?? null, after }))

  let storageKey: string | null = null
  if (editable && !(await db.evidence.findFirst({ where: { activityRecordId, sha256: d.sha256 } }))) {
    const chunks: Buffer[] = []
    for await (const c of storage.read(d.storageKey)) chunks.push(c as Buffer)
    storageKey = `${organizationId}/${randomUUID()}`
    await storage.put(storageKey, Buffer.concat(chunks))
  }
  try {
    await db.$transaction(async (tx) => {
      const e = storageKey ? await tx.evidence.create({ data: { organizationId, activityRecordId, fileName: d.fileName, mimeType: d.mimeType, sizeBytes: d.sizeBytes, sha256: d.sha256, storageKey, uploadedById: userId } }) : null
      await tx.intakeMatch.create({ data: { organizationId, documentId: d.id, invoiceIndex, activityRecordId, withEvidence: editable, matchedById: userId } })
      if (!d.activityRecordId) await tx.intakeDocument.update({ where: { id: d.id }, data: { activityRecordId } })
      if (corrections.length) await tx.intakeCorrection.createMany({ data: corrections.map((c) => ({ organizationId, documentId: d.id, invoiceIndex, userId, ...c })) })
      await writeAudit({ organizationId, actorUserId: userId, action: 'document.attached', entityType: 'IntakeDocument', entityId: d.id, after: { activityRecordId, invoiceIndex, evidenceId: e?.id ?? null, corrections: corrections.length } }, tx)
    })
  } catch (e) {
    if (storageKey) await storage.remove(storageKey).catch(() => {})
    throw e
  }
  res.status(204).end()
}

export const deleteDocument: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const db = getPrisma()
  const d = await findDocument(req.params.id as string, organizationId)
  if (d.status === 'PROCESSING' && d.updatedAt >= stuckBefore()) throw new HttpError(409, 'This document is still being read. Try again in a moment.')
  await db.$transaction(async (tx) => {
    await tx.intakeDocument.delete({ where: { id: d.id } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'document.deleted', entityType: 'IntakeDocument', entityId: d.id, before: { fileName: d.fileName, sha256: d.sha256 } }, tx)
  })
  await storage.remove(d.storageKey).catch(() => {})
  res.status(204).end()
}

export const downloadDocument: RequestHandler = async (req, res, next) => {
  const d = await findDocument(req.params.id as string, orgId(req))
  res.setHeader('Content-Type', d.mimeType)
  res.setHeader('Content-Length', d.sizeBytes)
  res.setHeader('Content-Disposition', `${d.mimeType === 'text/csv' ? 'attachment' : 'inline'}; filename*=UTF-8''${encodeURIComponent(d.fileName)}`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  // Shown beside the entry form, so only this app's own pages may frame it. PDFs are not sandboxed: the browser's PDF viewer refuses to run in a sandbox.
  res.setHeader('X-Frame-Options', 'SAMEORIGIN')
  res.setHeader('Content-Security-Policy', `default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; frame-ancestors 'self'${d.mimeType === 'application/pdf' ? '' : '; sandbox'}`)
  res.setHeader('Cache-Control', 'private, no-store')
  storage.read(d.storageKey)
    .on('error', (err) => (res.headersSent ? res.destroy(err) : next(new HttpError(404, 'File is missing from storage'))))
    .pipe(res)
}

// ---- Platform: AI service status and usage (Super Admin) ----
export const aiStatus: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const page = Math.max(1, Number(req.query.page) || 1)
  const since = new Date(Date.now() - 30 * 86_400_000)
  const sums = { _sum: { inputTokens: true, outputTokens: true, estimatedCostUsd: true }, _count: true } as const
  const [all, failed, month, byOrg, orgCount] = await Promise.all([
    db.aiUsageEvent.aggregate(sums),
    db.aiUsageEvent.count({ where: { success: false } }),
    db.aiUsageEvent.aggregate({ ...sums, where: { createdAt: { gte: since } } }),
    db.aiUsageEvent.groupBy({ by: ['organizationId'], ...sums, orderBy: { _count: { organizationId: 'desc' } }, skip: (page - 1) * DOCUMENT_PAGE_SIZE, take: DOCUMENT_PAGE_SIZE }),
    db.aiUsageEvent.groupBy({ by: ['organizationId'] }).then((g) => g.length),
  ])
  const orgs = await db.organization.findMany({ where: { id: { in: byOrg.map((o) => o.organizationId) } }, select: { id: true, name: true } })
  const totals = (a: typeof all) => ({ calls: a._count, inputTokens: a._sum.inputTokens ?? 0, outputTokens: a._sum.outputTokens ?? 0, estimatedCostUsd: a._sum.estimatedCostUsd?.toString() ?? null })
  res.json({
    // Whether a key is set is all that ever leaves the server; the key itself never does.
    provider: env.AI_PROVIDER, model: env.AI_MODEL ?? null, keySet: aiKeySet(), pricesSet: env.AI_INPUT_COST_PER_MILLION !== undefined && env.AI_OUTPUT_COST_PER_MILLION !== undefined,
    allTime: { ...totals(all), failed }, last30Days: totals(month),
    rows: byOrg.map((o) => ({ organizationId: o.organizationId, name: orgs.find((x) => x.id === o.organizationId)?.name ?? '—', ...totals(o) })),
    total: orgCount, page, pageSize: DOCUMENT_PAGE_SIZE,
  })
}

const TEST_HINT: Record<string, string> = {
  NOT_CONFIGURED: 'Set AI_PROVIDER, AI_MODEL and the API key in the server environment, then restart the app.',
  INVALID_KEY: 'The provider rejected the API key. Check the key in the server environment, then restart the app.',
  MODEL_NOT_FOUND: 'The provider does not recognise this model. Check AI_MODEL, then restart the app.',
  QUOTA: 'The key works, but its quota or rate limit has been reached.',
  TIMEOUT: 'The provider did not respond in time. Try again shortly.',
  NETWORK: 'The server could not reach the provider. Check the server\'s internet access.',
  UNAVAILABLE: 'The provider is temporarily unavailable. Try again shortly.',
  BAD_RESPONSE: 'The provider sent an unexpected response.',
}

export const aiTestConnection: RequestHandler = async (req, res) => {
  let body: { ok: boolean; code?: string; message: string }
  try {
    const { provider, model } = aiConfig()
    await provider.testConnection(model)
    body = { ok: true, message: `Connected to ${provider.name} using ${model}.` }
  } catch (e) {
    const code = e instanceof AiError ? e.code : 'UNEXPECTED'
    body = { ok: false, code, message: TEST_HINT[code] ?? 'The connection test failed unexpectedly.' }
  }
  await writeAudit({ actorUserId: req.auth!.userId, action: 'ai.connection_tested', entityType: 'AiService', after: { ok: body.ok, code: body.code ?? null } })
  res.json(body)
}
