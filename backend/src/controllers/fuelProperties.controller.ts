// Site fuel properties register (workbook tab 05 rules 1 and 5, J-10): the laboratory NCV, density, carbon content
// and biogenic share of one fuel at one facility for one calendar month, with its certificate. Entered by Data
// Entry, approved by a Reviewer or Tenant Admin (not the person who entered it, unless a Tenant Admin), and only then
// applied by calculations. A correction is a new version; the approved one it replaces is kept as SUPERSEDED,
// so results calculated with it can always be reproduced.
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { optionalText } from '../middleware/validate.js'
import { writeAudit } from '../services/audit.js'
import { storage } from '../storage/index.js'
import { decodeName, sanitizeFileName, TYPES } from './evidence.controller.js'
import { removeFiles } from './activities.controller.js'

const fraction = (what: string) => z.union([z.number(), z.string()]).transform((v) => String(v).trim())
  .pipe(z.string().regex(/^(0(\.\d{1,12})?|1(\.0{1,12})?)$/, `${what} is a fraction between 0 and 1`))
  .refine((v) => Number(v) > 0, `${what} must be greater than zero`)
const number = (what: string) => z.union([z.number(), z.string()]).transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,12})?$/, `${what} must be a number`))
  .refine((v) => Number(v) > 0, `${what} must be greater than zero`)

export const fuelPropertySchema = z.object({
  facilityId: z.uuid(),
  activityCode: z.string().trim().min(1),
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Give the month as YYYY-MM'),
  // V-14: NCV in TJ per tonne. Real fuels lie far below 1 TJ/t (hydrogen ≈ 0.12); a larger figure is a unit slip.
  ncv: number('NCV').refine((v) => Number(v) <= 1, 'NCV is in TJ per tonne (e.g. 43 GJ/t is 0.043). This looks like GJ per tonne.').optional(),
  density: number('Density').optional(),
  densityUnit: z.enum(['kg/l', 'kg/m3']).optional(),
  carbonContent: fraction('Carbon content').optional(), // t C per t fuel, from the ultimate analysis
  oxidationFactor: fraction('Oxidation factor').optional(), // default 1 (IPCC 2006)
  biogenicSharePct: z.union([z.number(), z.string()]).transform((v) => Number(String(v).trim()))
    .refine((v) => Number.isFinite(v) && v > 0 && v < 100, 'Biogenic share of a blend is between 0 and 100% (exclusive)').optional(),
  certificateRef: z.string().trim().min(2, 'Give the laboratory certificate number or reference').max(200),
  laboratory: optionalText(200),
  sampleDate: z.iso.date().nullish(),
  notes: optionalText(2000),
}).refine((p) => !!(p.ncv || p.density || p.carbonContent || p.biogenicSharePct), { message: 'Enter at least one property: NCV, density, carbon content or biogenic share', path: ['ncv'] })
  .refine((p) => !p.density === !p.densityUnit, { message: 'Give the density together with its unit', path: ['densityUnit'] })

export const reviewFuelPropertySchema = z.object({ note: optionalText(500) })

const include = { facility: { select: { name: true, code: true } }, activityType: { select: { name: true } }, createdBy: { select: { name: true } }, reviewedBy: { select: { name: true } } } as const

export const listFuelProperties: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const q = z.object({ facilityId: z.uuid().optional(), activityCode: z.string().optional(), status: z.enum(['DRAFT', 'APPROVED', 'REJECTED', 'SUPERSEDED']).optional() }).parse(req.query)
  res.json(await getPrisma().fuelProperty.findMany({
    where: { organizationId, ...q },
    include,
    orderBy: [{ month: 'desc' }, { facilityId: 'asc' }, { activityCode: 'asc' }, { version: 'desc' }],
    take: 500,
  }))
}

export const createFuelProperty: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const p = req.body as z.infer<typeof fuelPropertySchema>
  const db = getPrisma()
  const [facility, activity] = await Promise.all([
    db.facility.findFirst({ where: { id: p.facilityId, organizationId } }),
    db.activityType.findUnique({ where: { code: p.activityCode } }),
  ])
  if (!facility) throw new HttpError(404, 'Facility not found')
  if (!activity || !['C-01', 'C-02', 'C-03'].includes(activity.formulaCode ?? '')) throw new HttpError(400, 'Fuel properties apply to combustion fuels only')
  const month = new Date(`${p.month}-01T00:00:00Z`)
  const created = await db.$transaction(async (tx) => {
    const last = await tx.fuelProperty.findFirst({ where: { facilityId: p.facilityId, activityCode: p.activityCode, month }, orderBy: { version: 'desc' } })
    if (last?.status === 'DRAFT') throw new HttpError(409, `Version ${last.version} for this month is still awaiting review. Approve or reject it first.`)
    const row = await tx.fuelProperty.create({
      data: {
        organizationId, facilityId: p.facilityId, activityCode: p.activityCode, month, version: (last?.version ?? 0) + 1,
        ncv: p.ncv ?? null, density: p.density ?? null, densityUnit: p.densityUnit ?? null,
        carbonContent: p.carbonContent ?? null, oxidationFactor: p.oxidationFactor ?? null,
        biogenicShare: p.biogenicSharePct != null ? String(p.biogenicSharePct / 100) : null,
        certificateRef: p.certificateRef, laboratory: p.laboratory ?? null, sampleDate: p.sampleDate ? new Date(p.sampleDate) : null, notes: p.notes ?? null,
        createdById: req.auth!.userId,
      },
      include,
    })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'fuel_property.created', entityType: 'FuelProperty', entityId: row.id, after: row }, tx)
    return row
  })
  res.status(201).json(created)
}

async function findDraft(req: Parameters<RequestHandler>[0]) {
  const row = await getPrisma().fuelProperty.findFirst({ where: { id: req.params.id as string, organizationId: orgId(req) } })
  if (!row) throw new HttpError(404, 'Fuel property not found')
  if (row.status !== 'DRAFT') throw new HttpError(409, `This version is ${row.status.toLowerCase()}; only a draft can be reviewed.`)
  // Segregation of duties, as for activity records: a Tenant Admin may approve their own entry.
  if (row.createdById === req.auth!.userId && req.auth!.role !== 'TENANT_ADMIN') throw new HttpError(403, 'You cannot review a value you entered. Ask another reviewer.')
  return row
}

export const approveFuelProperty: RequestHandler = async (req, res) => {
  const row = await findDraft(req)
  if (!row.evidenceFile) throw new HttpError(409, 'Attach the laboratory certificate before approving (J-10).')
  const { note } = req.body as z.infer<typeof reviewFuelPropertySchema>
  const db = getPrisma()
  const updated = await db.$transaction(async (tx) => {
    // The approved version it replaces stays, marked SUPERSEDED: past results keep pointing at it.
    await tx.fuelProperty.updateMany({ where: { facilityId: row.facilityId, activityCode: row.activityCode, month: row.month, status: 'APPROVED' }, data: { status: 'SUPERSEDED' } })
    const u = await tx.fuelProperty.update({ where: { id: row.id }, data: { status: 'APPROVED', reviewedById: req.auth!.userId, reviewedAt: new Date(), reviewNote: note ?? null }, include })
    await writeAudit({ organizationId: row.organizationId, actorUserId: req.auth!.userId, action: 'fuel_property.approved', entityType: 'FuelProperty', entityId: row.id, reason: note ?? undefined }, tx)
    return u
  })
  res.json(updated)
}

export const rejectFuelProperty: RequestHandler = async (req, res) => {
  const row = await findDraft(req)
  const { note } = req.body as z.infer<typeof reviewFuelPropertySchema>
  if (!note) throw new HttpError(400, 'Say why the value is rejected')
  const db = getPrisma()
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.fuelProperty.update({ where: { id: row.id }, data: { status: 'REJECTED', reviewedById: req.auth!.userId, reviewedAt: new Date(), reviewNote: note }, include })
    await writeAudit({ organizationId: row.organizationId, actorUserId: req.auth!.userId, action: 'fuel_property.rejected', entityType: 'FuelProperty', entityId: row.id, reason: note }, tx)
    return u
  })
  res.json(updated)
}

// The laboratory certificate (PDF or image), stored outside the web root like activity evidence. Drafts only.
export const uploadCertificate: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const db = getPrisma()
  const row = await db.fuelProperty.findFirst({ where: { id: req.params.id as string, organizationId } })
  if (!row) throw new HttpError(404, 'Fuel property not found')
  if (row.status !== 'DRAFT') throw new HttpError(409, 'The certificate of a reviewed value cannot be changed; enter a new version instead.')
  const fileName = sanitizeFileName(decodeName(req.headers['x-file-name']))
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  const ext = path.extname(fileName).toLowerCase()
  const type = TYPES[ext]
  const problem = !fileName || !ext ? 'File name is missing or invalid'
    : !type ? `File type not allowed. Allowed: ${Object.keys(TYPES).join(', ')}`
    : data.length === 0 ? 'The file is empty'
    : !type.looksRight(data) ? `The file content does not match its ${ext} extension` : null
  if (problem) throw new HttpError(400, problem)
  const storageKey = `${organizationId}/${randomUUID()}`
  await storage.put(storageKey, data)
  try {
    const sha256 = createHash('sha256').update(data).digest('hex')
    const updated = await db.$transaction(async (tx) => {
      const u = await tx.fuelProperty.update({ where: { id: row.id }, data: { evidenceFile: storageKey, evidenceName: fileName, evidenceSha256: sha256 }, include })
      await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'fuel_property.certificate_uploaded', entityType: 'FuelProperty', entityId: row.id, after: { fileName, sizeBytes: data.length, sha256 } }, tx)
      return u
    })
    if (row.evidenceFile) await removeFiles([row.evidenceFile]) // a draft's earlier upload, never used by a result
    res.status(201).json(updated)
  } catch (e) {
    await removeFiles([storageKey])
    throw e
  }
}

export const downloadCertificate: RequestHandler = async (req, res, next) => {
  const row = await getPrisma().fuelProperty.findFirst({ where: { id: req.params.id as string, organizationId: orgId(req) } })
  if (!row?.evidenceFile) throw new HttpError(404, 'No certificate attached')
  const ext = path.extname(row.evidenceName ?? '').toLowerCase()
  res.setHeader('Content-Type', TYPES[ext]?.mime ?? 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(row.evidenceName ?? 'certificate')}`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  storage.read(row.evidenceFile)
    .on('error', (err) => (res.headersSent ? res.destroy(err) : next(new HttpError(404, 'File is missing from storage'))))
    .pipe(res)
}
