// External verifiers see only the reporting periods a Tenant Admin granted them (VerifierGrant), and in
// them only approved records. Every tenant read that verifiers can reach goes through these helpers.
import type { Request } from 'express'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'

export const isVerifier = (req: Request) => req.auth?.role === 'VERIFIER'

// Granted period ids for a verifier; null for every other role (no restriction).
export async function grantedPeriods(req: Request): Promise<string[] | null> {
  if (!isVerifier(req)) return null
  const grants = await getPrisma().verifierGrant.findMany({
    where: { userId: req.auth!.userId, organizationId: req.auth!.organizationId! }, select: { reportingPeriodId: true },
  })
  return grants.map((g) => g.reportingPeriodId)
}

// Prisma `where` fragment for activity records the caller may see.
export async function recordScope(req: Request) {
  const ids = await grantedPeriods(req)
  return ids ? { reportingPeriodId: { in: ids }, status: 'APPROVED' as const } : {}
}

// A period outside a verifier's grants behaves exactly like one that does not exist.
export async function assertPeriodVisible(req: Request, reportingPeriodId: string, notFound = 'Reporting period not found') {
  const ids = await grantedPeriods(req)
  if (ids && !ids.includes(reportingPeriodId)) throw new HttpError(404, notFound)
}
