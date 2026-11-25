// Loaded via --import before every test file: points the app at an isolated test database,
// builds it and empties it. Never touches dev data.
// PostgreSQL (default): the "test" schema, via migrations. MySQL (TEST_DATABASE_URL=mysql://…):
// a separate "<db>_test" database, rebuilt with `prisma db push`.
import { execSync } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after } from 'node:test'

try { process.loadEnvFile() } catch { /* rely on real env vars */ }
const url = new URL(process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '')
const mysql = url.protocol === 'mysql:'
if (mysql) url.pathname = `${url.pathname.replace(/_test$/, '')}_test`
else url.searchParams.set('schema', 'test')
process.env.DATABASE_URL = url.href
process.env.NODE_ENV = 'test'
process.env.MFA_ENCRYPTION_KEY = 'test-only-key-0123456789-abcdefghijklmnop'
process.env.AUTH_RATE_LIMIT = '100000' // suites sign in hundreds of times from one IP; the limiter has its own test
process.env.AI_ALLOWED_ORGS = '*' // document tests exercise reading; the per-organisation switch has its own test
process.env.STORAGE_DIR = mkdtempSync(join(tmpdir(), 'tula-evidence-')) // uploaded test files never touch real storage

// TRUNCATE bypasses the append-only row trigger, which is what a test reset needs.
const tables = ['InstrumentAllocation', 'EnergyInstrument', 'TargetBaselineRevision', 'CarbonTarget', 'IntensityMetric', 'Scenario', 'ReconciliationItem', 'Reconciliation', 'DataQualityReview', 'IntakeCorrection', 'IntakeMatch', 'AiUsageEvent', 'IntakeDocument', 'AuditLog', 'VerificationQueryMessage', 'VerificationQuery', 'VerifierGrant', 'PeriodLockEvent', 'ActivityReview', 'CalculationResult', 'CalculationRun', 'EmissionFactor', 'ActivityType', 'Unit', 'GridRegion', 'SubscriptionEvent', 'Subscription', 'Evidence', 'ActivityRecord', 'EmissionSource', 'ReportingPeriod', 'DataEntryAssignment', 'FacilitySiteHistory', 'Facility', 'Site','OrgBoundary', 'Session', 'Membership', 'User', 'Organization']
const { getPrisma } = await import('../src/config/database.js')
after(() => getPrisma().$disconnect()) // the MySQL pool otherwise keeps the test process alive
if (mysql) {
  execSync('npx prisma db push', { stdio: 'ignore', env: process.env })
  execSync('node scripts/mysql-audit-trigger.mjs', { stdio: 'ignore', env: process.env })
  const { default: mariadb } = await import('mariadb')
  const conn = await mariadb.createConnection(url.href.replace(/^mysql:/, 'mariadb:')) // one connection: the FK switch is per-session
  await conn.query('SET FOREIGN_KEY_CHECKS = 0')
  for (const t of tables) await conn.query(`TRUNCATE TABLE \`${t}\``)
  await conn.end()
} else {
  execSync('npx prisma migrate deploy', { stdio: 'ignore', env: process.env })
  // Table names are schema-qualified: raw SQL does not get the client's schema setting.
  await getPrisma().$executeRawUnsafe(`TRUNCATE ${tables.map((t) => `"test"."${t}"`).join(', ')} CASCADE`)
}

// Workbook reference data (activity types, units, grid regions, factors), as every deployment has.
const { seedReferenceData } = await import('../src/calc/referenceData.js')
await seedReferenceData(getPrisma())
