import type { RequestHandler } from 'express'
import { z } from 'zod'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'

import type { createFacilitySchema } from './facilities.controller.js'

const facilityBoundarySchema = z.object({
  facilityId:        z.string().uuid(),
  gridLocation:      z.string().max(120).nullable().optional(),
  equityShare:       z.number().min(0).max(100).nullable().optional(),
  operationalControl: z.boolean().nullable().optional(),
  financialControl:  z.boolean().nullable().optional(),
  scope1Active:      z.boolean().optional(),
  scope2Active:      z.boolean().optional(),
})

export const saveBoundarySchema = z.object({
  approach:     z.enum(['EQUITY', 'OPERATIONAL', 'FINANCIAL']),
  baseYear:     z.number().int().min(2000).max(2100),
  effectiveFrom: z.string().date(),
  facilities:   z.array(facilityBoundarySchema),
  // also update org-level base year
})

export const newVersionSchema = z.object({
  changeReason: z.string().min(1).max(500),
})

// Frozen copy of the values an approved version was approved with; later edits never change it.
const snapshotOf = (f: { id: string; code: string; name: string; country: string | null; gridLocation: string | null; equityShare: unknown; operationalControl: boolean | null; financialControl: boolean | null; scope1Active: boolean; scope2Active: boolean }) => ({
  id: f.id, code: f.code, name: f.name, country: f.country, gridLocation: f.gridLocation,
  equityShare: f.equityShare == null ? null : Number(f.equityShare),
  operationalControl: f.operationalControl, financialControl: f.financialControl,
  scope1Active: f.scope1Active, scope2Active: f.scope2Active,
})

function orgIdParam(req: Parameters<RequestHandler>[0]): string {
  const id = req.params.id
  return Array.isArray(id) ? id[0]! : id
}

// GET /platform/organizations/:id/boundary — current boundary (latest version)
export const getBoundary: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const id = orgIdParam(req)
  const org = await db.organization.findUnique({
    where: { id },
    select: { id: true, name: true, baseYear: true, fiscalYearStartMonth: true },
  })
  if (!org) throw new HttpError(404, 'Organization not found')
  const boundary = await db.orgBoundary.findFirst({
    where: { organizationId: id },
    orderBy: { version: 'desc' },
    select: {
      id: true, version: true, approach: true, status: true,
      effectiveFrom: true, baseYear: true,
      approvedAt: true, changeReason: true, snapshot: true,
      approvedBy: { select: { id: true, name: true } },
    },
  })
  const facilities = await db.facility.findMany({
    where: { organizationId: id },
    select: {
      id: true, name: true, code: true, country: true, isActive: true,
      gridLocation: true, equityShare: true, operationalControl: true,
      financialControl: true, scope1Active: true, scope2Active: true,
    },
    orderBy: { name: 'asc' },
  })
  // Decimal serialises as a string; the client edits and re-sends it as a number.
  res.json({ org, boundary, facilities: facilities.map((f) => ({ ...f, equityShare: f.equityShare == null ? null : Number(f.equityShare) })) })
}

// GET /platform/organizations/:id/boundary/history
export const getBoundaryHistory: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const org = await db.organization.findUnique({ where: { id: orgIdParam(req) }, select: { id: true } })
  if (!org) throw new HttpError(404, 'Organization not found')
  const history = await db.orgBoundary.findMany({
    where: { organizationId: orgIdParam(req) },
    orderBy: { version: 'desc' },
    select: {
      id: true, version: true, approach: true, status: true,
      effectiveFrom: true, baseYear: true, approvedAt: true, changeReason: true, snapshot: true,
      approvedBy: { select: { id: true, name: true } },
    },
  })
  res.json(history)
}

// PUT /platform/organizations/:id/boundary — save/update the current DRAFT
export const saveBoundary: RequestHandler = async (req, res) => {
  const { approach, baseYear, effectiveFrom, facilities } = req.body as z.infer<typeof saveBoundarySchema>
  const db = getPrisma()
  const org = await db.organization.findUnique({ where: { id: orgIdParam(req) }, select: { id: true } })
  if (!org) throw new HttpError(404, 'Organization not found')

  // Find or create the draft
  const existing = await db.orgBoundary.findFirst({
    where: { organizationId: orgIdParam(req) },
    orderBy: { version: 'desc' },
  })
  if (existing?.status === 'APPROVED') throw new HttpError(409, 'Boundary is approved. Create a new version to make changes.')

  // Grid locations must be listed regions: the calculation engine looks their factors up by name.
  const grids = [...new Set(facilities.map((f) => f.gridLocation).filter((g): g is string => !!g))]
  const known = await db.gridRegion.findMany({ where: { name: { in: grids } }, select: { name: true } })
  const unknown = grids.filter((g) => !known.some((k) => k.name === g))
  if (unknown.length) throw new HttpError(400, `Unknown grid location: ${unknown.join(', ')}`)

  const result = await db.$transaction(async (tx) => {
    // Update org baseYear
    await tx.organization.update({ where: { id: orgIdParam(req) }, data: { baseYear } })

    // Upsert facilities boundary fields
    for (const f of facilities) {
      const fac = await tx.facility.findFirst({ where: { id: f.facilityId, organizationId: orgIdParam(req) } })
      if (!fac) continue
      await tx.facility.update({
        where: { id: f.facilityId },
        data: {
          gridLocation: f.gridLocation ?? null,
          equityShare: f.equityShare != null ? f.equityShare : null,
          operationalControl: f.operationalControl ?? null,
          financialControl: f.financialControl ?? null,
          scope1Active: f.scope1Active ?? true,
          scope2Active: f.scope2Active ?? true,
        },
      })
    }

    // Upsert draft boundary record
    let boundary
    if (existing) {
      boundary = await tx.orgBoundary.update({
        where: { id: existing.id },
        data: { approach, baseYear, effectiveFrom: new Date(effectiveFrom) },
      })
    } else {
      boundary = await tx.orgBoundary.create({
        data: {
          organizationId: orgIdParam(req),
          version: 1,
          approach,
          baseYear,
          effectiveFrom: new Date(effectiveFrom),
          status: 'DRAFT',
        },
      })
    }
    await writeAudit({ actorUserId: req.auth!.userId, action: 'boundary.saved', entityType: 'OrgBoundary', entityId: boundary.id, organizationId: orgIdParam(req) }, tx)
    return boundary
  })

  res.json(result)
}

// POST /platform/organizations/:id/boundary/approve
export const approveBoundary: RequestHandler = async (req, res) => {
  const db = getPrisma()
  const draft = await db.orgBoundary.findFirst({
    where: { organizationId: orgIdParam(req), status: 'DRAFT' },
    orderBy: { version: 'desc' },
  })
  if (!draft) throw new HttpError(404, 'No draft boundary to approve')
  const facilities = await db.facility.findMany({ where: { organizationId: orgIdParam(req), isActive: true }, orderBy: { name: 'asc' } })
  if (facilities.length === 0) throw new HttpError(400, 'Add at least one active facility before approving')
  const problems = facilities.flatMap((f) => {
    const issues: string[] = []
    if (draft.approach === 'EQUITY' && f.equityShare == null) issues.push('missing equity share')
    if (draft.approach === 'OPERATIONAL' && f.operationalControl == null) issues.push('missing operational control')
    if (draft.approach === 'FINANCIAL' && f.financialControl == null) issues.push('missing financial control')
    if (!f.scope1Active && !f.scope2Active) issues.push('no scope selected')
    if (f.scope2Active && !f.gridLocation) issues.push('missing grid location')
    return issues.length ? [`${f.name}: ${issues.join(', ')}`] : []
  })
  if (problems.length) throw new HttpError(400, `Cannot approve. ${problems.join('; ')}`)
  const boundary = await db.$transaction(async (tx) => {
    const b = await tx.orgBoundary.update({
      where: { id: draft.id },
      data: { status: 'APPROVED', approvedAt: new Date(), approvedById: req.auth!.userId, snapshot: facilities.map(snapshotOf) },
    })
    await writeAudit({ actorUserId: req.auth!.userId, action: 'boundary.approved', entityType: 'OrgBoundary', entityId: b.id, organizationId: orgIdParam(req) }, tx)
    return b
  })
  res.json(boundary)
}

// POST /platform/organizations/:id/boundary/new-version
export const newBoundaryVersion: RequestHandler = async (req, res) => {
  const { changeReason } = req.body as z.infer<typeof newVersionSchema>
  const db = getPrisma()
  const current = await db.orgBoundary.findFirst({
    where: { organizationId: orgIdParam(req) },
    orderBy: { version: 'desc' },
  })
  if (!current) throw new HttpError(404, 'No boundary exists for this organization')
  if (current.status === 'DRAFT') throw new HttpError(409, 'A draft already exists')

  const next = await db.$transaction(async (tx) => {
    const b = await tx.orgBoundary.create({
      data: {
        organizationId: orgIdParam(req),
        version: current.version + 1,
        approach: current.approach,
        baseYear: current.baseYear,
        effectiveFrom: current.effectiveFrom,
        status: 'DRAFT',
        changeReason,
      },
    })
    await writeAudit({ actorUserId: req.auth!.userId, action: 'boundary.new_version', entityType: 'OrgBoundary', entityId: b.id, organizationId: orgIdParam(req), reason: changeReason }, tx)
    return b
  })
  res.json(next)
}

// POST /platform/organizations/:id/facilities — add a site while setting up the boundary
export const createOrgFacility: RequestHandler = async (req, res) => {
  const organizationId = orgIdParam(req)
  const db = getPrisma()
  if (!(await db.organization.findUnique({ where: { id: organizationId }, select: { id: true } }))) throw new HttpError(404, 'Organization not found')
  const facility = await db.$transaction(async (tx) => {
    const f = await tx.facility.create({ data: { ...(req.body as z.infer<typeof createFacilitySchema>), organizationId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'facility.created', entityType: 'Facility', entityId: f.id, after: f }, tx)
    return f
  })
  res.status(201).json(facility)
}
