import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { RequestHandler } from 'express'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'
import { storage } from '../storage/index.js'
import { assertEditable, findRecord, removeFiles } from './activities.controller.js'
import { isVerifier, recordScope } from '../services/verifierScope.js'

export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024

// Type is decided by the extension and confirmed by the file's first bytes;
// the browser-sent Content-Type is ignored (it varies by OS and can be anything).
export const TYPES: Record<string, { mime: string; looksRight: (b: Buffer) => boolean }> = {
  '.pdf': { mime: 'application/pdf', looksRight: (b) => b.subarray(0, 5).toString('latin1') === '%PDF-' },
  '.png': { mime: 'image/png', looksRight: (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  '.jpg': { mime: 'image/jpeg', looksRight: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.jpeg': { mime: 'image/jpeg', looksRight: (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  '.xlsx': { mime: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', looksRight: (b) => b.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04])) },
  '.csv': { mime: 'text/csv', looksRight: (b) => !b.includes(0) }, // plain text: no NUL bytes
}
export const ALLOWED_EXTENSIONS = Object.keys(TYPES)

// Keeps a readable, safe display name: no path parts, control or odd characters.
export function sanitizeFileName(raw: string): string {
  const base = path.basename(raw.replace(/\\/g, '/')).normalize('NFC')
  return base.replace(/[^\p{L}\p{M}\p{N} ._()-]/gu, '_').replace(/^\.+/, '').slice(-150).trim()
}

export function decodeName(header: string | string[] | undefined) {
  try { return typeof header === 'string' ? decodeURIComponent(header) : '' } catch { return '' }
}

// Body is the raw file (express.raw on the route); name comes from the X-File-Name header.
export const uploadEvidence: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const db = getPrisma()
  const record = await findRecord(db, req)
  assertEditable(record, req.auth!)

  const fileName = sanitizeFileName(decodeName(req.headers['x-file-name']))
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  const ext = path.extname(fileName).toLowerCase()
  const type = TYPES[ext]
  const problem =
    !fileName || !ext ? 'File name is missing or invalid'
    : !type ? `File type not allowed. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`
    : data.length === 0 ? 'The file is empty'
    : !type.looksRight(data) ? `The file content does not match its ${ext} extension`
    : null
  if (problem) {
    await writeAudit({ organizationId, actorUserId: userId, action: 'evidence.upload_rejected', entityType: 'ActivityRecord', entityId: record.id, reason: problem, after: { fileName, sizeBytes: data.length } })
    throw new HttpError(400, problem)
  }

  // File first, then the row; if the row fails, remove the file so nothing is orphaned.
  const storageKey = `${organizationId}/${randomUUID()}`
  await storage.put(storageKey, data)
  try {
    const evidence = await db.$transaction(async (tx) => {
      const e = await tx.evidence.create({
        data: {
          organizationId, activityRecordId: record.id, fileName, mimeType: type!.mime, sizeBytes: data.length,
          sha256: createHash('sha256').update(data).digest('hex'), storageKey, uploadedById: userId,
        },
        select: { id: true, fileName: true, mimeType: true, sizeBytes: true, sha256: true, createdAt: true },
      })
      await writeAudit({ organizationId, actorUserId: userId, action: 'evidence.uploaded', entityType: 'Evidence', entityId: e.id, after: { activityRecordId: record.id, fileName, sizeBytes: data.length, sha256: e.sha256 } }, tx)
      return e
    })
    res.status(201).json(evidence)
  } catch (e) {
    await removeFiles([storageKey])
    throw e
  }
}

export const downloadEvidence: RequestHandler = async (req, res, next) => {
  const organizationId = orgId(req)
  const e = await getPrisma().evidence.findFirst({ where: { id: req.params.id as string, organizationId, activityRecord: await recordScope(req) } })
  if (!e) throw new HttpError(404, 'File not found')
  if (isVerifier(req)) await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'verifier.evidence_downloaded', entityType: 'Evidence', entityId: e.id })
  const inline = req.query.inline === '1' && e.mimeType !== 'text/csv' // view in browser for PDFs and images
  res.setHeader('Content-Type', e.mimeType)
  res.setHeader('Content-Length', e.sizeBytes)
  res.setHeader('Content-Disposition', `${inline ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(e.fileName)}`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Content-Security-Policy', "default-src 'none'; img-src 'self'; style-src 'unsafe-inline'; sandbox")
  res.setHeader('Cache-Control', 'private, no-store')
  storage.read(e.storageKey)
    .on('error', (err) => (res.headersSent ? res.destroy(err) : next(new HttpError(404, 'File is missing from storage'))))
    .pipe(res)
}

export const deleteEvidence: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const db = getPrisma()
  const key = await db.$transaction(async (tx) => {
    const e = await tx.evidence.findFirst({ where: { id: req.params.id as string, organizationId }, include: { activityRecord: { include: { reportingPeriod: { select: { status: true, name: true } } } } } })
    if (!e) throw new HttpError(404, 'File not found')
    assertEditable(e.activityRecord, req.auth!)
    await tx.evidence.delete({ where: { id: e.id } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'evidence.deleted', entityType: 'Evidence', entityId: e.id, before: { activityRecordId: e.activityRecordId, fileName: e.fileName, sha256: e.sha256 } }, tx)
    return e.storageKey
  })
  await removeFiles([key])
  res.status(204).end()
}
