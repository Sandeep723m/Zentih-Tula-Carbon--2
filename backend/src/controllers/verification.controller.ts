// External verification: Tenant Admins grant a verifier specific reporting periods; verifiers raise
// queries on a period or one record; the organisation answers; the verifier closes. All audited.
import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma } from '../../generated/prisma/client.js'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'
import { assertPeriodVisible, grantedPeriods, isVerifier } from '../services/verifierScope.js'

// ---- Grants (Tenant Admin) -------------------------------------------------------------------

export const listGrants: RequestHandler = async (req, res) => {
  res.json(await getPrisma().verifierGrant.findMany({
    where: { organizationId: orgId(req) },
    include: { user: { select: { id: true, name: true, email: true } }, reportingPeriod: { select: { id: true, name: true } }, grantedBy: { select: { name: true } } },
    orderBy: { createdAt: 'desc' },
  }))
}

export const grantSchema = z.object({ userId: z.uuid(), reportingPeriodId: z.uuid() })

export const createGrant: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const { userId, reportingPeriodId } = req.body as z.infer<typeof grantSchema>
  const grant = await getPrisma().$transaction(async (tx) => {
    // One connection per transaction: queries run one after another.
    const member = await tx.membership.findUnique({ where: { userId_organizationId: { userId, organizationId } } })
    const period = await tx.reportingPeriod.findFirst({ where: { id: reportingPeriodId, organizationId } })
    if (!member || member.role !== 'VERIFIER') throw new HttpError(400, 'Access can only be granted to a verifier of this organisation')
    if (!period) throw new HttpError(400, 'Reporting period not found')
    if (await tx.verifierGrant.findUnique({ where: { userId_reportingPeriodId: { userId, reportingPeriodId } } })) throw new HttpError(409, 'This verifier already has access to that period')
    const g = await tx.verifierGrant.create({ data: { organizationId, userId, reportingPeriodId, grantedById: req.auth!.userId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'verifier.access_granted', entityType: 'VerifierGrant', entityId: g.id, after: { userId, reportingPeriodId } }, tx)
    return g
  })
  res.status(201).json(grant)
}

export const deleteGrant: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  await getPrisma().$transaction(async (tx) => {
    const g = await tx.verifierGrant.findFirst({ where: { id: req.params.id as string, organizationId } })
    if (!g) throw new HttpError(404, 'Access grant not found')
    await tx.verifierGrant.delete({ where: { id: g.id } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'verifier.access_revoked', entityType: 'VerifierGrant', entityId: g.id, before: g }, tx)
  })
  res.status(204).end()
}

// ---- Queries ---------------------------------------------------------------------------------

const listQuery = z.object({
  reportingPeriodId: z.uuid().optional(),
  activityRecordId: z.uuid().optional(),
  status: z.enum(['OPEN', 'ANSWERED', 'CLOSED']).optional(),
  page: z.coerce.number().int().min(1).max(100_000).default(1),
})
export const QUERY_PAGE_SIZE = 50
const summary = {
  reportingPeriod: { select: { id: true, name: true } },
  activityRecord: { select: { id: true, startDate: true, endDate: true, emissionSource: { select: { name: true } }, facility: { select: { name: true } } } },
  raisedBy: { select: { name: true } },
} satisfies Prisma.VerificationQueryInclude

export const listQueries: RequestHandler = async (req, res) => {
  const q = listQuery.parse(req.query)
  const granted = await grantedPeriods(req)
  const where: Prisma.VerificationQueryWhereInput = {
    organizationId: orgId(req), status: q.status, activityRecordId: q.activityRecordId,
    AND: [{ reportingPeriodId: q.reportingPeriodId }, granted ? { reportingPeriodId: { in: granted } } : {}],
  }
  const db = getPrisma()
  const [rows, total] = await Promise.all([
    db.verificationQuery.findMany({ where, include: { ...summary, _count: { select: { messages: true } } }, orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }], skip: (q.page - 1) * QUERY_PAGE_SIZE, take: QUERY_PAGE_SIZE }),
    db.verificationQuery.count({ where }),
  ])
  res.json({ rows, total, page: q.page, pageSize: QUERY_PAGE_SIZE })
}

async function findQuery(req: Parameters<RequestHandler>[0], tx: Prisma.TransactionClient | ReturnType<typeof getPrisma> = getPrisma()) {
  const query = await tx.verificationQuery.findFirst({ where: { id: req.params.id as string, organizationId: orgId(req) } })
  if (!query) throw new HttpError(404, 'Query not found')
  await assertPeriodVisible(req, query.reportingPeriodId, 'Query not found')
  return query
}

export const getQuery: RequestHandler = async (req, res) => {
  const q = await findQuery(req)
  res.json(await getPrisma().verificationQuery.findUniqueOrThrow({
    where: { id: q.id },
    include: { ...summary, messages: { include: { author: { select: { name: true } } }, orderBy: { createdAt: 'asc' } } },
  }))
}

const body = z.string().trim().min(3, 'Write at least 3 characters').max(5000)
export const createQuerySchema = z.object({
  reportingPeriodId: z.uuid('Select a reporting period'),
  activityRecordId: z.uuid().optional(),
  subject: z.string().trim().min(3).max(200),
  message: body,
})

export const createQuery: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const d = req.body as z.infer<typeof createQuerySchema>
  await assertPeriodVisible(req, d.reportingPeriodId)
  const query = await getPrisma().$transaction(async (tx) => {
    if (!(await tx.reportingPeriod.findFirst({ where: { id: d.reportingPeriodId, organizationId } }))) throw new HttpError(404, 'Reporting period not found')
    if (d.activityRecordId && !(await tx.activityRecord.findFirst({ where: { id: d.activityRecordId, organizationId, reportingPeriodId: d.reportingPeriodId, status: 'APPROVED' } }))) {
      throw new HttpError(400, 'That record is not an approved record of this period')
    }
    const created = await tx.verificationQuery.create({
      data: { organizationId, reportingPeriodId: d.reportingPeriodId, activityRecordId: d.activityRecordId, subject: d.subject, raisedById: userId, messages: { create: { authorId: userId, body: d.message } } },
    })
    await writeAudit({ organizationId, actorUserId: userId, action: 'verification.query_raised', entityType: 'VerificationQuery', entityId: created.id, after: { subject: d.subject, reportingPeriodId: d.reportingPeriodId, activityRecordId: d.activityRecordId ?? null } }, tx)
    return created
  })
  res.status(201).json(query)
}

export const messageSchema = z.object({ body })

// A verifier's message reopens the query for the organisation (OPEN); an organisation reply marks it ANSWERED.
export const addMessage: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const userId = req.auth!.userId
  const { body: text } = req.body as z.infer<typeof messageSchema>
  const status = isVerifier(req) ? 'OPEN' : 'ANSWERED'
  const message = await getPrisma().$transaction(async (tx) => {
    const q = await findQuery(req, tx)
    if (q.status === 'CLOSED') throw new HttpError(409, 'This query is closed')
    const m = await tx.verificationQueryMessage.create({ data: { queryId: q.id, authorId: userId, body: text } })
    await tx.verificationQuery.update({ where: { id: q.id }, data: { status } })
    await writeAudit({ organizationId, actorUserId: userId, action: isVerifier(req) ? 'verification.query_followed_up' : 'verification.query_answered', entityType: 'VerificationQuery', entityId: q.id, after: { status } }, tx)
    return m
  })
  res.status(201).json(message)
}

export const closeQuery: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const query = await getPrisma().$transaction(async (tx) => {
    const q = await findQuery(req, tx)
    const changed = await tx.verificationQuery.updateMany({ where: { id: q.id, status: { not: 'CLOSED' } }, data: { status: 'CLOSED', closedAt: new Date() } })
    if (changed.count !== 1) throw new HttpError(409, 'This query is already closed')
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'verification.query_closed', entityType: 'VerificationQuery', entityId: q.id, before: { status: q.status } }, tx)
    return tx.verificationQuery.findUniqueOrThrow({ where: { id: q.id } })
  })
  res.json(query)
}
