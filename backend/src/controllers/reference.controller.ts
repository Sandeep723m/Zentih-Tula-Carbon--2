// Reference data: grid regions, activity types, units and the emission factor library.
// Two tiers (TC-ARC-006): the platform library, read-only in every tenant and published by the platform team;
// and each organisation's own factors, visible to that organisation only and never to anyone else (Super Admin
// included). Organisation factors go Draft -> In review -> Approved -> In use -> Superseded, forward only.
import { createHash, randomUUID } from 'node:crypto'
import path from 'node:path'
import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma } from '../../generated/prisma/client.js'
import { allowedShapes, checkFactorShape, factorLabel, usableFactor } from '../calc/core/factorRules.js'
import { isCalculable, parametersFor } from '../calc/registry.js'
import { can } from '../auth/permissions.js'
import { getPrisma, isMySql } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { optionalText } from '../middleware/validate.js'
import { writeAudit } from '../services/audit.js'
import { storage } from '../storage/index.js'
import { removeFiles } from './activities.controller.js'
import { decodeName, sanitizeFileName, TYPES } from './evidence.controller.js'

export const listGridRegions: RequestHandler = async (_req, res) => {
  res.json(await getPrisma().gridRegion.findMany({ orderBy: { sortOrder: 'asc' } }))
}

// With the extra inputs each formula's methods ask for, so the entry form can show them.
// A process activity's "which factor" choice lists its own tab 04 factors (lime type, plant type…).
export const listActivityTypes: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const [types, processFactors] = await Promise.all([
    db.activityType.findMany({ orderBy: { code: 'asc' } }),
    db.emissionFactor.findMany({ where: { AND: [{ activityType: { formulaCode: 'C-04' }, status: { in: ['APPROVED', 'IN_USE'] } }, visibility(req)] }, orderBy: { code: 'asc' } }),
  ])
  res.json(types.map((t) => ({
    ...t,
    calculable: isCalculable(t.formulaCode),
    factorShapes: allowedShapes(t), // gas and units a library factor for this activity may take (factor form)
    fields: parametersFor(t.formulaCode).fields.map((f) => f.name !== 'factorCode' ? f : {
      ...f,
      options: processFactors.filter((x) => x.activityCode === t.code).map((x) => ({ value: x.code, label: `${x.code}: ${x.value} ${x.numeratorUnit} per ${x.denominatorUnit}${x.notes ? ` (${x.notes.split('.')[0]})` : ''}` })),
    }),
  })))
}

export const listUnits: RequestHandler = async (_req, res) => {
  res.json(await getPrisma().unit.findMany({ orderBy: [{ dimension: 'asc' }, { code: 'asc' }] }))
}

export const FACTOR_PAGE_SIZE = 50
// Factor library tabs: tab 02 categories of the factor's activity; GWPs have no activity.
const KINDS: Record<string, Prisma.EmissionFactorWhereInput> = {
  electricity: { activityType: { category: 'Purchased electricity' } },
  stationary: { activityType: { category: 'Stationary combustion' } },
  mobile: { activityType: { category: 'Mobile combustion' } },
  fugitive: { activityType: { category: 'Fugitive' } },
  process: { activityType: { category: 'Process' } },
  gwp: { activityCode: null },
  other: { activityType: { category: { in: ['Purchased steam / heat / cooling', 'Removal / recovery'] } } },
}
// Why a tab may hold few or no library factors: these activities take their value elsewhere (tab 05 rule 11, C-08).
const KIND_EXPLANATIONS: Record<string, Array<{ activity: string; requirement: string }>> = {
  other: [
    { activity: 'Purchased steam (A-STEAM)', requirement: 'Supplier-specific emission factor required (kg CO2e per GJ, from the supplier invoice or disclosure). There is no generic default; without it the calculation stops (V-19). Enter it on the record, or add it once as your organisation\'s own factor.' },
    { activity: 'Purchased heating (A-HEAT)', requirement: 'Supplier-specific emission factor required (kg CO2e per GJ). No generic default (V-19).' },
    { activity: 'Purchased cooling (A-COOL)', requirement: 'Supplier-specific emission factor required (kg CO2e per GJ or per ton-hour). No generic default (V-19).' },
    { activity: 'CO2 recovered (A-CO2-REC)', requirement: 'Direct measured quantity required: the metered tonnes of CO2 recovered. No emission factor applies; it is reported as a separate removal line, never subtracted from emissions (C-08, G-06).' },
  ],
}
const factorQuery = z.object({
  kind: z.enum(Object.keys(KINDS) as [string, ...string[]]).optional(),
  q: z.string().trim().max(100).optional(), // factor code, activity code or name, gas, source
  page: z.coerce.number().int().min(1).max(100_000).default(1),
  scope: z.enum(['shared', 'organization']).optional(),
  status: z.enum(['DRAFT', 'IN_REVIEW', 'APPROVED', 'IN_USE', 'SUPERSEDED']).optional(),
})

// Who sees which factors (section 5): Super Admins the platform library only, never a tenant's factors;
// everyone else the published platform library and their own organisation's factors.
function visibility(req: Parameters<RequestHandler>[0]): Prisma.EmissionFactorWhereInput {
  if (req.auth!.platformRole === 'SUPER_ADMIN') return { organizationId: null }
  const org = req.auth!.organizationId
  return { OR: [{ organizationId: null, status: { in: ['APPROVED', 'IN_USE', 'SUPERSEDED'] } }, ...(org ? [{ organizationId: org }] : [])] }
}

// Paged and filtered in the database (the workbook alone ships 240+ factors).
export const listFactors: RequestHandler = async (req, res) => {
  const { q, page, kind, scope, status } = factorQuery.parse(req.query)
  const like = q ? (isMySql() ? { contains: q } : { contains: q, mode: 'insensitive' as const }) : undefined
  const search: Prisma.EmissionFactorWhereInput = like
    ? { OR: [{ code: like }, { activityCode: like }, { gas: like }, { source: like }, { activityType: { name: like } }] }
    : {}
  const filters: Prisma.EmissionFactorWhereInput = {
    ...(scope === 'shared' ? { organizationId: null } : scope === 'organization' ? { organizationId: { not: null } } : {}),
    ...(status ? { status } : {}),
  }
  const base: Prisma.EmissionFactorWhereInput[] = [visibility(req), search, filters]
  const where: Prisma.EmissionFactorWhereInput = { AND: [...base, kind ? KINDS[kind] : {}] }
  const db = getPrisma()
  const kindCounts = Object.fromEntries(await Promise.all(Object.entries(KINDS).map(async ([k, w]) => [k, await db.emissionFactor.count({ where: { AND: [...base, w] } })] as const)))
  const [rows, total, units, activities] = await Promise.all([
    db.emissionFactor.findMany({
      where,
      include: {
        activityType: { select: { name: true, formulaCode: true } }, region: { select: { name: true } }, organization: { select: { name: true } },
        createdBy: { select: { name: true } }, approvedBy: { select: { name: true } }, withdrawnBy: { select: { name: true } },
      },
      orderBy: [{ activityCode: 'asc' }, { gas: 'asc' }, { regionCode: 'asc' }, { validFrom: 'desc' }, { code: 'asc' }], // code: same order on every database
      skip: (page - 1) * FACTOR_PAGE_SIZE,
      take: FACTOR_PAGE_SIZE,
    }),
    db.emissionFactor.count({ where }),
    db.unit.findMany(),
    db.activityType.findMany(),
  ])
  const byCode = new Map(activities.map((a) => [a.code, a]))
  res.json({
    rows: rows.map((f) => ({
      ...f,
      shared: f.organizationId === null,
      label: factorLabel(f),
      // Whether calculations can select it: approved or in use, and its gas and units fit the activity (factorRules.ts).
      usable: usableFactor(f, byCode, units),
      problem: f.activityCode && byCode.get(f.activityCode) ? shapeProblem(f, byCode.get(f.activityCode)!, units) : null,
    })),
    total, page, pageSize: FACTOR_PAGE_SIZE, counts: kindCounts,
    explanations: kind ? KIND_EXPLANATIONS[kind] ?? [] : [],
  })
}

function shapeProblem(f: { gas: string; numeratorUnit: string; denominatorUnit: string }, activity: { code: string; name: string; formulaCode: string | null }, units: { code: string; dimension: string; toBase: unknown }[]) {
  if (!activity.formulaCode) return activity.code === 'A-PPA' ? null : `${activity.name} has no calculation yet (agriculture and similar sources are planned for Phase 2), so this factor is kept for reference only.`
  const r = checkFactorShape(f, activity, units as never)
  return r.ok ? null : r.message
}

const decimal = z
  .union([z.number(), z.string()])
  .transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,15}(\.\d{1,15})?$/, 'Enter a number only, without units, e.g. 0.716'))

export const TIERS = ['Tier 1 default', 'Tier 2 country', 'Tier 3 site-specific'] as const
const ORIGINS = ['Fossil', 'Biogenic'] as const
const USABLE = ['APPROVED', 'IN_USE'] as const // what calculations may select

const factorFields = {
  activityCode: z.string().trim().min(1, 'Select an activity'),
  regionCode: z.string().trim().min(1).nullish(),
  gas: z.string().trim().min(1).max(20).default('CO2e'),
  value: decimal,
  numeratorUnit: z.string().trim().min(1, 'Select the factor unit').max(40),
  denominatorUnit: z.string().trim().min(1, 'Select the unit the factor is per').max(60),
  gwpSet: z.enum(['AR6', 'AR5']).nullish(), // refrigerant GWPs only
  carbonOrigin: z.enum(ORIGINS).optional(), // defaults to the activity's
  source: z.string().trim().min(2, 'Name the source document').max(300),
  sourceVersion: z.string().trim().min(1, 'Give the version or edition').max(100),
  validFrom: z.iso.date('Enter a valid start date'),
  validTo: z.iso.date().nullish(),
  geography: z.string().trim().min(1, 'Describe the geography').max(200),
  tier: z.string().trim().min(1).max(50),
  basis: optionalText(2000),
  notes: optionalText(2000),
}
const datesInOrder = (f: { validFrom?: string; validTo?: string | null }) => !f.validTo || !f.validFrom || f.validTo >= f.validFrom
export const createFactorSchema = z.object({
  code: z.string().trim().regex(/^[A-Za-z0-9-]{2,40}$/, 'Use a short ID, e.g. EF-0342'),
  ...factorFields,
  supersedesId: z.uuid().nullish(), // a new version of this factor; on approval the old one is end-dated
}).refine(datesInOrder, { message: 'Valid to must be on or after valid from', path: ['validTo'] })
export const updateFactorSchema = z.object(factorFields).partial().refine(datesInOrder, { message: 'Valid to must be on or after valid from', path: ['validTo'] })
export const supersedeFactorSchema = z.object({
  reason: z.string().trim().min(5, 'Say why the factor is end-dated').max(500),
  endDate: z.iso.date().nullish(), // last day it applies; default: today
})
export const approveFactorSchema = z.object({
  note: optionalText(1000),
  // Section 3.2: the reviewer confirms each check (platform publish: the source was verified against the cited table).
  checks: z.object({ source: z.literal(true), units: z.literal(true), tier: z.literal(true), validity: z.literal(true) }, { error: 'Confirm all four checks before approving' }),
})
export const returnFactorSchema = z.object({ comment: z.string().trim().min(5, 'Say what needs to change').max(1000) })

type FactorInput = z.infer<typeof updateFactorSchema>
type Req = Parameters<RequestHandler>[0]
type FactorRowDb = NonNullable<Awaited<ReturnType<ReturnType<typeof getPrisma>['emissionFactor']['findUnique']>>>

// The backend is authoritative: everything the form checks is checked here, against the activity's accepted units.
interface FactorShapeInput { activityCode: string | null; gas: string; value: string; numeratorUnit: string; denominatorUnit: string; regionCode?: string | null; gwpSet?: string | null; carbonOrigin?: string | null }
async function validateFactor(f: FactorShapeInput, organizationId: string | null) {
  const db = getPrisma()
  if (!f.activityCode) throw new HttpError(400, 'GWP values for all activities come from the reference library and are not edited here.')
  const [activity, units, region] = await Promise.all([
    db.activityType.findUnique({ where: { code: f.activityCode } }),
    db.unit.findMany(),
    f.regionCode ? db.gridRegion.findUnique({ where: { code: f.regionCode } }) : null,
  ])
  if (!activity) throw new HttpError(400, 'Unknown activity')
  if (f.regionCode && !region) throw new HttpError(400, 'Unknown grid region')
  const shape = checkFactorShape({ gas: f.gas, numeratorUnit: f.numeratorUnit, denominatorUnit: f.denominatorUnit }, activity, units)
  if (!shape.ok) throw new HttpError(400, `${shape.message} If the unit you need is not offered, request it instead of choosing another.`)
  const grid = activity.sourceCategory === 'PURCHASED_ELECTRICITY' || activity.code === 'A-PPA'
  if (activity.sourceCategory === 'PURCHASED_ELECTRICITY' && !f.regionCode) throw new HttpError(400, 'Grid electricity factors need a grid region')
  if (!grid && f.regionCode) throw new HttpError(400, 'Only grid electricity factors have a grid region')
  if (activity.formulaCode === 'C-05' && !f.gwpSet) throw new HttpError(400, 'Refrigerant and gas GWPs need their assessment set (AR6 or AR5)')
  if (activity.formulaCode !== 'C-05' && f.gwpSet) throw new HttpError(400, 'Only refrigerant and gas GWPs carry an AR6 or AR5 set')
  if (activity.formulaCode === 'C-21' && !organizationId) throw new HttpError(400, 'Steam, heat and cooling factors are supplier-specific: they belong to the organisation, not the platform library')
  if (Number(f.value) <= 0 && activity.code !== 'A-PPA') throw new HttpError(400, 'The factor value must be greater than zero')
  const origin = f.carbonOrigin ?? (ORIGINS.includes(activity.carbonOrigin as never) ? activity.carbonOrigin : null)
  return { ...shape.shape, carbonOrigin: origin ?? activity.carbonOrigin, gwpBasis: f.gwpSet ? 'GWP-100' : null }
}

const day = (d: Date) => d.toISOString().slice(0, 10)
const label = (f: { organizationId: string | null; tier: string }) => factorLabel(f)

// Section 3.1: what a tenant factor must carry before it can leave Draft. Returns what is missing.
async function missingForReview(f: FactorRowDb) {
  const missing: string[] = []
  if (!f.evidenceFile) missing.push('attach the evidence file (source document, lab report or supplier declaration)')
  if (!f.basis || f.basis.trim().length < 20) missing.push('write the basis: how the value was derived and what it must not be used for (at least 20 characters)')
  if (!TIERS.includes(f.tier as never)) missing.push(`choose the tier (${TIERS.join(', ')})`)
  if (!ORIGINS.includes(f.carbonOrigin as never)) missing.push('choose the carbon origin (Fossil or Biogenic)')
  const overlap = await overlapping(f)
  if (overlap) missing.push(`change the validity dates: they overlap ${overlap.code} (${day(overlap.validFrom)} to ${overlap.validTo ? day(overlap.validTo) : 'open-ended'}) for the same activity and gas`)
  return missing
}

// Section 3.1: overlapping validity for the same activity and gas (and grid region) is rejected, among the
// organisation's own factors that are under review or usable. The version a factor replaces is ignored.
async function overlapping(f: FactorRowDb) {
  const others = await getPrisma().emissionFactor.findMany({
    where: {
      organizationId: f.organizationId, activityCode: f.activityCode, gas: f.gas, regionCode: f.regionCode,
      status: { in: ['IN_REVIEW', ...USABLE] }, id: { notIn: [f.id, ...(f.supersedesId ? [f.supersedesId] : [])] },
    },
  })
  const end = (d: Date | null) => d?.getTime() ?? Infinity
  return others.find((o) => o.validFrom.getTime() <= end(f.validTo) && f.validFrom.getTime() <= end(o.validTo)) ?? null
}

// One rule for every factor action. Platform factors: Super Admin only. Tenant factors: members of that
// organisation with the action's permission; Super Admin and other organisations get "not found" (section 5).
async function factorFor(req: Req, permission: 'factor.write' | 'factor.approve' | 'factor.supersede') {
  const f = await getPrisma().emissionFactor.findUnique({ where: { id: req.params.id as string } })
  const auth = req.auth!
  const superAdmin = auth.platformRole === 'SUPER_ADMIN'
  if (!f || (f.organizationId && f.organizationId !== auth.organizationId) || (f.organizationId && superAdmin)) throw new HttpError(404, 'Factor not found')
  if (!f.organizationId && !superAdmin) throw new HttpError(403, 'The platform library is read-only. Your organisation can add its own factor instead.')
  if (f.organizationId && !(auth.role && can(auth.role, permission))) throw new HttpError(403, 'Your role cannot do this')
  return f
}

const audit = (req: Req, f: { id: string; organizationId: string | null }, action: string, extra: { reason?: string; before?: unknown; after?: unknown } = {}, tx?: Parameters<typeof writeAudit>[1]) =>
  writeAudit({ organizationId: f.organizationId, actorUserId: req.auth!.userId, action, entityType: 'EmissionFactor', entityId: f.id, ...extra } as Parameters<typeof writeAudit>[0], tx)

async function create(req: Req, organizationId: string | null) {
  const f = req.body as z.infer<typeof createFactorSchema>
  const checked = await validateFactor(f, organizationId)
  const db = getPrisma()
  if (f.supersedesId) {
    const old = await db.emissionFactor.findUnique({ where: { id: f.supersedesId } })
    if (!old || old.organizationId !== organizationId || !USABLE.includes(old.status as never)) throw new HttpError(400, 'Only an approved factor of the same library can be replaced by a new version')
    if (old.activityCode !== f.activityCode || old.gas !== checked.gas) throw new HttpError(400, 'A new version keeps the activity and gas of the factor it replaces')
  }
  if (organizationId && !TIERS.includes(f.tier as never)) throw new HttpError(400, `Choose the tier: ${TIERS.join(', ')}`)
  if (await db.emissionFactor.findUnique({ where: { code: f.code } })) throw new HttpError(409, `The ID ${f.code} is already used. Choose another.`)
  const userId = req.auth!.userId
  return db.$transaction(async (tx) => {
    const created = await tx.emissionFactor.create({
      data: {
        ...f, ...checked, regionCode: f.regionCode ?? null, gwpSet: f.gwpSet ?? null, organizationId, createdById: userId, status: 'DRAFT',
        validFrom: new Date(f.validFrom), validTo: f.validTo ? new Date(f.validTo) : null, supersedesId: f.supersedesId ?? null,
      },
    })
    await audit(req, created, 'emission_factor.created', { after: { ...created, label: label(created) } }, tx)
    return created
  })
}

// Platform library (Super Admin, outside any tenant): proposed as a draft, then published.
export const createFactor: RequestHandler = async (req, res) => {
  res.status(201).json(await create(req, null))
}

// The organisation's own factor (Data Entry, Tenant Admin, Reviewer): always starts as a draft (A-2).
export const createOrgFactor: RequestHandler = async (req, res) => {
  res.status(201).json(await create(req, req.auth!.organizationId!))
}

// Drafts are edited by their organisation's writers; an approved factor not yet used only by a Reviewer
// (section 5). A factor under review, in use or superseded is never edited.
export const updateFactor: RequestHandler = async (req, res) => {
  const probe = await getPrisma().emissionFactor.findUnique({ where: { id: req.params.id as string }, select: { status: true } })
  const f = await factorFor(req, probe?.status === 'APPROVED' ? 'factor.approve' : 'factor.write')
  if (f.status === 'IN_REVIEW') throw new HttpError(409, 'This factor is under review. A reviewer returns it to draft if it needs changes.')
  if (f.status === 'IN_USE') throw new HttpError(409, 'This factor is used by calculation results and is frozen. Create a new version instead.')
  if (f.status === 'SUPERSEDED') throw new HttpError(409, 'This factor is superseded and cannot be edited.')
  if (f.status === 'APPROVED' && !f.organizationId) throw new HttpError(409, 'A published platform factor is not edited. Publish a new version instead.')
  if (f.status === 'APPROVED' && await getPrisma().calculationResult.count({ where: { emissionFactorId: f.id } })) throw new HttpError(409, 'This factor is used by calculation results and is frozen. Create a new version instead.')
  const patch = req.body as FactorInput
  if (patch.tier && f.organizationId && !TIERS.includes(patch.tier as never)) throw new HttpError(400, `Choose the tier: ${TIERS.join(', ')}`)
  const merged = { ...f, value: f.value.toString(), validFrom: day(f.validFrom), validTo: f.validTo ? day(f.validTo) : null, ...patch }
  const checked = await validateFactor(merged, f.organizationId)
  const db = getPrisma()
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.emissionFactor.update({
      where: { id: f.id },
      data: {
        ...patch, ...checked, gwpSet: merged.gwpSet ?? null,
        ...(patch.validFrom ? { validFrom: new Date(patch.validFrom) } : {}),
        ...(patch.validTo !== undefined ? { validTo: patch.validTo ? new Date(patch.validTo) : null } : {}),
      },
    })
    if (u.status === 'APPROVED' && await overlapping(u)) throw new HttpError(409, 'These validity dates overlap another factor for the same activity and gas.')
    await audit(req, f, 'emission_factor.updated', { before: f, after: u }, tx)
    return u
  })
  res.json(updated)
}

// Evidence for a tenant factor (or the source extract of a platform proposal). Drafts only; stored outside the web root.
export const uploadFactorEvidence: RequestHandler = async (req, res) => {
  const f = await factorFor(req, 'factor.write')
  if (f.status !== 'DRAFT') throw new HttpError(409, 'Evidence is attached while the factor is a draft.')
  const fileName = sanitizeFileName(decodeName(req.headers['x-file-name']))
  const data = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0)
  const ext = path.extname(fileName).toLowerCase()
  const type = TYPES[ext]
  const problem = !fileName || !ext ? 'File name is missing or invalid'
    : !type ? `File type not allowed. Allowed: ${Object.keys(TYPES).join(', ')}`
    : data.length === 0 ? 'The file is empty'
    : !type.looksRight(data) ? `The file content does not match its ${ext} extension` : null
  if (problem) throw new HttpError(400, problem)
  const storageKey = `${f.organizationId ?? 'platform'}/${randomUUID()}`
  await storage.put(storageKey, data)
  try {
    const sha256 = createHash('sha256').update(data).digest('hex')
    const updated = await getPrisma().$transaction(async (tx) => {
      const u = await tx.emissionFactor.update({ where: { id: f.id }, data: { evidenceFile: storageKey, evidenceName: fileName, evidenceSha256: sha256 } })
      await audit(req, f, 'emission_factor.evidence_attached', { after: { fileName, sizeBytes: data.length, sha256 } }, tx)
      return u
    })
    if (f.evidenceFile) await removeFiles([f.evidenceFile])
    res.status(201).json(updated)
  } catch (e) {
    await removeFiles([storageKey])
    throw e
  }
}

export const downloadFactorEvidence: RequestHandler = async (req, res, next) => {
  const f = await getPrisma().emissionFactor.findFirst({ where: { AND: [{ id: req.params.id as string }, visibility(req)] } })
  if (!f?.evidenceFile) throw new HttpError(404, 'No evidence attached')
  const ext = path.extname(f.evidenceName ?? '').toLowerCase()
  res.setHeader('Content-Type', TYPES[ext]?.mime ?? 'application/octet-stream')
  res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(f.evidenceName ?? 'evidence')}`)
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('Cache-Control', 'private, no-store')
  storage.read(f.evidenceFile)
    .on('error', (err) => (res.headersSent ? res.destroy(err) : next(new HttpError(404, 'File is missing from storage'))))
    .pipe(res)
}

// Draft -> In review (tenant factors). Everything section 3.1 requires must be present first.
export const submitFactor: RequestHandler = async (req, res) => {
  const f = await factorFor(req, 'factor.write')
  if (!f.organizationId) throw new HttpError(409, 'Platform factors are published directly by the platform team.')
  if (f.status !== 'DRAFT') throw new HttpError(409, `This factor is ${statusWord(f.status)}; only a draft is submitted for review.`)
  await validateFactor({ ...f, value: f.value.toString() }, f.organizationId)
  const missing = await missingForReview(f)
  if (missing.length) throw new HttpError(400, `Before submitting: ${missing.join('; ')}.`)
  // O-4: with no reviewer who could approve it (not its creator or submitter), it stays a draft. No self-approval fallback.
  const reviewers = await getPrisma().membership.count({ where: { organizationId: f.organizationId, role: 'REVIEWER', user: { isActive: true }, userId: { notIn: [f.createdById ?? '-', req.auth!.userId] } } })
  if (!reviewers) throw new HttpError(409, 'Your organisation has no other reviewer who could approve this factor, so it stays a draft. Ask your Tenant Admin to appoint a reviewer.')
  const updated = await getPrisma().$transaction(async (tx) => {
    const u = await tx.emissionFactor.update({ where: { id: f.id }, data: { status: 'IN_REVIEW', submittedById: req.auth!.userId, submittedAt: new Date() } })
    await audit(req, f, 'emission_factor.submitted', {}, tx)
    return u
  })
  res.json(updated)
}

// Ends a factor's use from a date and marks it superseded; results already calculated keep their snapshot.
async function endDate(tx: Parameters<Parameters<ReturnType<typeof getPrisma>['$transaction']>[0]>[0], f: FactorRowDb, by: string, on: Date, reason: string) {
  const validTo = f.validTo && f.validTo < on ? f.validTo : on < f.validFrom ? f.validFrom : on
  return tx.emissionFactor.update({ where: { id: f.id }, data: { status: 'SUPERSEDED', validTo, withdrawnById: by, withdrawnAt: new Date(), withdrawnReason: reason } })
}

// In review -> Approved (Reviewer, never the person who created or submitted it), or for the platform
// library Draft -> Approved ("published") by a Super Admin after verifying the source. A new version end-dates
// the one it replaces the day before it starts.
export const approveFactor: RequestHandler = async (req, res) => {
  const f = await factorFor(req, 'factor.approve')
  const userId = req.auth!.userId
  const { note } = req.body as z.infer<typeof approveFactorSchema>
  if (f.organizationId) {
    if (f.status !== 'IN_REVIEW') throw new HttpError(409, `This factor is ${statusWord(f.status)}; only a factor under review is approved.`)
    if (f.createdById === userId || f.submittedById === userId) throw new HttpError(403, 'You cannot approve a factor you created or submitted. Another reviewer must approve it.')
    const missing = await missingForReview(f)
    if (missing.length) throw new HttpError(409, `It cannot be approved yet: ${missing.join('; ')}.`)
  } else if (f.status !== 'DRAFT') throw new HttpError(409, `This factor is ${statusWord(f.status)}; only a draft is published.`)
  await validateFactor({ ...f, value: f.value.toString() }, f.organizationId)
  const db = getPrisma()
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.emissionFactor.update({ where: { id: f.id }, data: { status: 'APPROVED', approvedById: userId, approvedAt: new Date(), approvalNote: note ?? null } })
    await audit(req, f, f.organizationId ? 'emission_factor.approved' : 'emission_factor.published', { reason: note ?? undefined, after: { label: label(f), checks: ['source', 'units', 'tier', 'validity'] } }, tx)
    if (f.supersedesId) {
      const old = await tx.emissionFactor.findUnique({ where: { id: f.supersedesId } })
      if (old && USABLE.includes(old.status as never)) {
        const before = new Date(f.validFrom.getTime() - 86_400_000)
        await endDate(tx, old, userId, before, `Replaced by ${f.code} from ${day(f.validFrom)}`)
        await audit(req, old, 'emission_factor.superseded', { reason: `Replaced by ${f.code} from ${day(f.validFrom)}` }, tx)
      }
    }
    return u
  })
  res.json(updated)
}

// In review -> Draft with the reviewer's comments.
export const returnFactor: RequestHandler = async (req, res) => {
  const f = await factorFor(req, 'factor.approve')
  if (!f.organizationId || f.status !== 'IN_REVIEW') throw new HttpError(409, 'Only a factor under review can be returned.')
  const { comment } = req.body as z.infer<typeof returnFactorSchema>
  const updated = await getPrisma().$transaction(async (tx) => {
    const u = await tx.emissionFactor.update({ where: { id: f.id }, data: { status: 'DRAFT', submittedById: null, submittedAt: null } })
    await audit(req, f, 'emission_factor.returned', { reason: comment }, tx)
    return u
  })
  res.json(updated)
}

// Approved or in use -> Superseded, end-dated (Tenant Admin or Reviewer; Super Admin for the platform library).
export const supersedeFactor: RequestHandler = async (req, res) => {
  const f = await factorFor(req, 'factor.supersede')
  if (!USABLE.includes(f.status as never)) throw new HttpError(409, `This factor is ${statusWord(f.status)}; only an approved or in-use factor is end-dated.`)
  const { reason, endDate: end } = req.body as z.infer<typeof supersedeFactorSchema>
  const db = getPrisma()
  const [results, lockedResults] = await Promise.all([
    db.calculationResult.count({ where: { emissionFactorId: f.id } }),
    db.calculationResult.count({ where: { emissionFactorId: f.id, run: { reportingPeriod: { status: 'LOCKED' } } } }),
  ])
  const updated = await db.$transaction(async (tx) => {
    const u = await endDate(tx, f, req.auth!.userId, end ? new Date(end) : new Date(new Date().toISOString().slice(0, 10)), reason)
    await audit(req, f, 'emission_factor.superseded', { reason, after: { validTo: u.validTo, results, lockedResults } }, tx)
    return u
  })
  res.json({ ...updated, usage: { results, lockedResults } })
}

const STATUS_WORDS: Record<string, string> = { DRAFT: 'a draft', IN_REVIEW: 'under review', APPROVED: 'approved', IN_USE: 'in use', SUPERSEDED: 'superseded' }
const statusWord = (s: string) => STATUS_WORDS[s] ?? s.toLowerCase()

// Who created, submitted, approved, returned and superseded a factor (from the audit log), with its approval
// note, basis and evidence, and how often results used it. Readable by every role, the Verifier included.
export const factorHistory: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const f = await db.emissionFactor.findFirst({ where: { AND: [{ id: req.params.id as string }, visibility(req)] } })
  if (!f) throw new HttpError(404, 'Factor not found')
  const [events, results] = await Promise.all([
    db.auditLog.findMany({ where: { entityType: 'EmissionFactor', entityId: f.id }, orderBy: { createdAt: 'asc' }, select: { action: true, actorUserId: true, reason: true, createdAt: true } }),
    db.calculationResult.count({ where: { emissionFactorId: f.id, ...(f.organizationId ? {} : { organizationId: req.auth!.organizationId ?? '-' }) } }),
  ])
  const actors = await db.user.findMany({ where: { id: { in: events.map((e) => e.actorUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })
  const replaced = f.supersedesId ? await db.emissionFactor.findUnique({ where: { id: f.supersedesId }, select: { code: true } }) : null
  res.json({
    status: f.status, label: label(f), results, basis: f.basis, approvalNote: f.approvalNote, evidenceName: f.evidenceName,
    supersedes: replaced?.code ?? null,
    events: [
      ...(f.createdById ? [] : [{ action: 'emission_factor.seeded', actor: 'Reference library (initial load)', reason: null, at: f.createdAt }]),
      ...events.map((e) => ({ action: e.action, actor: actors.find((a) => a.id === e.actorUserId)?.name ?? null, reason: e.reason, at: e.createdAt })),
    ],
  })
}

// Every version of one factor (same activity, gas and region) in the same library, oldest first, with the change
// from the one before and how many calculation results used it (this organisation's; all for the platform team).
export const factorVersions: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const f = await db.emissionFactor.findFirst({ where: { AND: [{ id: req.params.id as string }, visibility(req)] } })
  if (!f) throw new HttpError(404, 'Factor not found')
  const platform = req.auth!.platformRole === 'SUPER_ADMIN'
  const organizationId = req.auth!.organizationId
  const versions = await db.emissionFactor.findMany({ where: { AND: [{ activityCode: f.activityCode, gas: f.gas, regionCode: f.regionCode, gwpSet: f.gwpSet, organizationId: f.organizationId }, visibility(req)] }, orderBy: [{ validFrom: 'asc' }, { createdAt: 'asc' }],
    select: { id: true, code: true, value: true, numeratorUnit: true, denominatorUnit: true, source: true, sourceVersion: true, validFrom: true, validTo: true, createdAt: true, status: true, organizationId: true } })
  const scope = platform ? {} : { organizationId: organizationId ?? '-' }
  const [used, confirmed, orgs] = await Promise.all([
    db.calculationResult.groupBy({ by: ['emissionFactorId'], where: { ...scope, emissionFactorId: { in: versions.map((v) => v.id) } }, _count: true }),
    db.calculationResult.groupBy({ by: ['emissionFactorId'], where: { ...scope, emissionFactorId: { in: versions.map((v) => v.id) }, run: { reportingPeriod: { status: 'LOCKED' } } }, _count: true }),
    platform ? db.calculationResult.groupBy({ by: ['emissionFactorId', 'organizationId'], where: { emissionFactorId: { in: versions.map((v) => v.id) } } }) : Promise.resolve([]),
  ])
  res.json({ platform, versions: versions.map((v, i) => ({
    ...v,
    changePercent: i ? ((Number(v.value) - Number(versions[i - 1].value)) / Number(versions[i - 1].value)) * 100 : null,
    results: used.find((u) => u.emissionFactorId === v.id)?._count ?? 0,
    inLockedPeriods: confirmed.find((u) => u.emissionFactorId === v.id)?._count ?? 0,
    organizations: platform ? orgs.filter((o) => o.emissionFactorId === v.id).length : null,
  })) })
}

// Platform library change log for every tenant (section 4 "Notify", O-3): what was published or end-dated.
// Open reporting periods are not affected: calculations take the factor in force at the period start.
export const libraryUpdates: RequestHandler = async (_req, res) => {
  const db = getPrisma()
  const events = await db.auditLog.findMany({
    where: { entityType: 'EmissionFactor', organizationId: null, action: { in: ['emission_factor.published', 'emission_factor.superseded'] } },
    orderBy: { createdAt: 'desc' }, take: 50, select: { action: true, entityId: true, reason: true, createdAt: true },
  })
  const factors = await db.emissionFactor.findMany({
    where: { id: { in: events.map((e) => e.entityId).filter((x): x is string => !!x) }, organizationId: null },
    select: { id: true, code: true, activityCode: true, gas: true, value: true, numeratorUnit: true, denominatorUnit: true, source: true, sourceVersion: true, validFrom: true, validTo: true, activityType: { select: { name: true } } },
  })
  res.json(events.flatMap((e) => {
    const f = factors.find((x) => x.id === e.entityId)
    return f ? [{ action: e.action === 'emission_factor.published' ? 'published' : 'end-dated', at: e.createdAt, reason: e.reason, factor: f }] : []
  }))
}

// Request a unit that is not offered (A-5). The platform team adds it to the controlled list or declines it.
export const unitRequestSchema = z.object({
  activityCode: z.string().trim().min(1).nullish(),
  unit: z.string().trim().min(1, 'Name the unit you need').max(60),
  reason: z.string().trim().min(10, 'Say what the factor is and why this unit is needed').max(1000),
})
export const resolveUnitRequestSchema = z.object({ status: z.enum(['ADDED', 'DECLINED']), resolution: z.string().trim().min(5, 'Give the answer for the requester').max(1000) })

export const createUnitRequest: RequestHandler = async (req, res) => {
  const b = req.body as z.infer<typeof unitRequestSchema>
  if (b.activityCode && !(await getPrisma().activityType.findUnique({ where: { code: b.activityCode } }))) throw new HttpError(400, 'Unknown activity')
  const row = await getPrisma().$transaction(async (tx) => {
    const r = await tx.unitRequest.create({ data: { organizationId: req.auth!.organizationId!, requestedById: req.auth!.userId, activityCode: b.activityCode ?? null, unit: b.unit, reason: b.reason } })
    await writeAudit({ organizationId: r.organizationId, actorUserId: req.auth!.userId, action: 'unit_request.created', entityType: 'UnitRequest', entityId: r.id, after: r }, tx)
    return r
  })
  res.status(201).json(row)
}

export const listUnitRequests: RequestHandler = async (req, res) => {
  const platform = req.auth!.platformRole === 'SUPER_ADMIN'
  res.json(await getPrisma().unitRequest.findMany({
    where: platform ? {} : { organizationId: req.auth!.organizationId ?? '-' },
    include: { requestedBy: { select: { name: true } }, resolvedBy: { select: { name: true } }, organization: { select: { name: true } } },
    orderBy: [{ status: 'asc' }, { createdAt: 'desc' }], take: 200,
  }))
}

export const resolveUnitRequest: RequestHandler = async (req, res) => {
  const b = req.body as z.infer<typeof resolveUnitRequestSchema>
  const db = getPrisma()
  const r = await db.unitRequest.findUnique({ where: { id: req.params.id as string } })
  if (!r) throw new HttpError(404, 'Request not found')
  if (r.status !== 'OPEN') throw new HttpError(409, 'This request is already answered.')
  const updated = await db.$transaction(async (tx) => {
    const u = await tx.unitRequest.update({ where: { id: r.id }, data: { status: b.status, resolution: b.resolution, resolvedById: req.auth!.userId, resolvedAt: new Date() } })
    await writeAudit({ organizationId: r.organizationId, actorUserId: req.auth!.userId, action: 'unit_request.resolved', entityType: 'UnitRequest', entityId: r.id, reason: b.resolution, after: { status: b.status } }, tx)
    return u
  })
  res.json(updated)
}
