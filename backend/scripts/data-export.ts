// Exports the current database (organisations, users, facilities, boundaries, …) to a JSON file
// that scripts/data-import.ts loads into another database, PostgreSQL or MySQL.
//   npx tsx scripts/data-export.ts [out-file]      (default: seed-data.json)
// Sessions are left out. Password hashes are exported but replaced on import.
import { writeFileSync } from 'node:fs'
import { getPrisma } from '../src/config/database.js'

const db = getPrisma()
const data = {
  exportedAt: new Date().toISOString(),
  organization: await db.organization.findMany(),
  subscription: await db.subscription.findMany(),
  subscriptionEvent: await db.subscriptionEvent.findMany(),
  user: await db.user.findMany(),
  membership: await db.membership.findMany(),
  facility: await db.facility.findMany(),
  reportingPeriod: await db.reportingPeriod.findMany(),
  emissionSource: await db.emissionSource.findMany(),
  orgBoundary: await db.orgBoundary.findMany(),
  activityRecord: await db.activityRecord.findMany(),
  evidence: await db.evidence.findMany(),
  intakeDocument: await db.intakeDocument.findMany(),
  aiUsageEvent: await db.aiUsageEvent.findMany(),
  emissionFactor: await db.emissionFactor.findMany({ where: { createdById: { not: null } } }), // seed factors come from reference:seed
  calculationRun: await db.calculationRun.findMany(),
  calculationResult: await db.calculationResult.findMany(),
  activityReview: await db.activityReview.findMany(),
  periodLockEvent: await db.periodLockEvent.findMany(),
  verifierGrant: await db.verifierGrant.findMany(),
  verificationQuery: await db.verificationQuery.findMany(),
  verificationQueryMessage: await db.verificationQueryMessage.findMany(),
  auditLog: await db.auditLog.findMany(),
}
const out = process.argv[2] ?? 'seed-data.json'
writeFileSync(out, JSON.stringify(data, null, 2))
console.log(`Exported to ${out}: ${Object.entries(data).filter(([, v]) => Array.isArray(v)).map(([k, v]) => `${k} ${(v as unknown[]).length}`).join(', ')}`)
await db.$disconnect()
