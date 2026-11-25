// Wipes all test/demo data, keeps reference data and WebAnatomy org + its users.
// Deletes every other organisation completely.
// For WebAnatomy: deletes all working data (facilities, periods, sources, records,
// evidence, runs, queries, grants, locks) but keeps the org, users, memberships,
// subscription and audit log.
// Reference data (EmissionFactor, ActivityType, Unit, GridRegion, etc.) is never touched.
//
// Usage: npx tsx scripts/wipe-test-data.ts --yes
import { getPrisma } from '../src/config/database.js'
import { storage } from '../src/storage/index.js'

const yes = process.argv.includes('--yes')
if (!yes) {
  console.error('Usage: npx tsx scripts/wipe-test-data.ts --yes')
  process.exit(1)
}

const db = getPrisma()

// Find WebAnatomy
const wa = await db.organization.findFirst({ where: { name: 'WebAnatomy' } })
if (!wa) {
  console.log('WebAnatomy organisation not found — nothing to do.')
  await db.$disconnect()
  process.exit(0)
}
console.log(`Keeping: WebAnatomy (${wa.id})`)

// Delete all OTHER organisations and their data (cascade via schema relations where
// possible; for tables without cascade we delete in order).
const others = await db.organization.findMany({ where: { id: { not: wa.id } }, select: { id: true, name: true } })
for (const org of others) {
  console.log(`Deleting org: ${org.name}`)
  const files = await db.evidence.findMany({ where: { organizationId: org.id }, select: { storageKey: true } })
  await db.$transaction([
    db.verificationQuery.deleteMany({ where: { organizationId: org.id } }),
    db.verifierGrant.deleteMany({ where: { organizationId: org.id } }),
    db.periodLockEvent.deleteMany({ where: { organizationId: org.id } }),
    db.calculationResult.deleteMany({ where: { organizationId: org.id } }),
    db.calculationRun.deleteMany({ where: { organizationId: org.id } }),
    db.activityReview.deleteMany({ where: { organizationId: org.id } }),
    db.evidence.deleteMany({ where: { organizationId: org.id } }),
    db.activityRecord.deleteMany({ where: { organizationId: org.id } }),
    db.emissionSource.deleteMany({ where: { organizationId: org.id } }),
    db.orgBoundary.deleteMany({ where: { organizationId: org.id } }),
    db.reportingPeriod.deleteMany({ where: { organizationId: org.id } }),
    db.facility.deleteMany({ where: { organizationId: org.id } }),
    db.membership.deleteMany({ where: { organizationId: org.id } }),
    db.subscription.deleteMany({ where: { organizationId: org.id } }),
    db.organization.delete({ where: { id: org.id } }),
  ])
  for (const f of files) await storage.remove(f.storageKey).catch(() => {})
}

// Wipe WebAnatomy's working data only
console.log('Wiping WebAnatomy working data (keeping org, users, memberships)…')
const waFiles = await db.evidence.findMany({ where: { organizationId: wa.id }, select: { storageKey: true } })
await db.$transaction([
  db.verificationQuery.deleteMany({ where: { organizationId: wa.id } }),
  db.verifierGrant.deleteMany({ where: { organizationId: wa.id } }),
  db.periodLockEvent.deleteMany({ where: { organizationId: wa.id } }),
  db.calculationResult.deleteMany({ where: { organizationId: wa.id } }),
  db.calculationRun.deleteMany({ where: { organizationId: wa.id } }),
  db.activityReview.deleteMany({ where: { organizationId: wa.id } }),
  db.evidence.deleteMany({ where: { organizationId: wa.id } }),
  db.activityRecord.deleteMany({ where: { organizationId: wa.id } }),
  db.emissionSource.deleteMany({ where: { organizationId: wa.id } }),
  db.orgBoundary.deleteMany({ where: { organizationId: wa.id } }),
  db.reportingPeriod.deleteMany({ where: { organizationId: wa.id } }),
  db.facility.deleteMany({ where: { organizationId: wa.id } }),
])
for (const f of waFiles) await storage.remove(f.storageKey).catch(() => {})

const counts = {
  factors: await db.emissionFactor.count(),
  activityTypes: await db.activityType.count(),
  units: await db.unit.count(),
  gridRegions: await db.gridRegion.count(),
}
console.log('Done. Reference data intact:', counts)
console.log('WebAnatomy org and users kept. All other organisations deleted.')
await db.$disconnect()
