// Loads a file written by scripts/data-export.ts into this database. Run reference:seed first:
// activity types, units, grid regions and the workbook factors are not in the export.
//   npm run data:import -- [file]        (server: npm run data:import:prod; default file: private/seed-data.json)
// Safe to re-run: rows whose id already exists are skipped. Every imported user gets a new random
// password and must reset it, so passwords from the source machine never work here.
import { randomBytes } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { hashPassword } from '../src/auth/crypto.js'
import { getPrisma } from '../src/config/database.js'

type Row = Record<string, unknown>
const file = process.argv[2] ?? 'private/seed-data.json'
const data = JSON.parse(readFileSync(file, 'utf8')) as Record<string, Row[]>
const db = getPrisma()

// Parents before children, so every foreign key already exists when its row is inserted.
const ORDER = ['organization', 'subscription', 'subscriptionEvent', 'user', 'membership', 'facility', 'reportingPeriod',
  'emissionSource', 'orgBoundary', 'activityRecord', 'evidence', 'intakeDocument', 'aiUsageEvent', 'emissionFactor', 'calculationRun', 'calculationResult',
  'activityReview', 'periodLockEvent', 'verifierGrant', 'verificationQuery', 'verificationQueryMessage', 'auditLog'] as const

const users = await Promise.all((data.user ?? []).map(async (u) => ({
  ...u, passwordHash: await hashPassword(randomBytes(24).toString('base64url')),
  mustChangePassword: true, mfaEnabled: false, mfaSecret: null, mfaLastStep: null, failedLoginCount: 0, lockedUntil: null,
})))

const counts: string[] = []
for (const model of ORDER) {
  const rows = model === 'user' ? users : data[model] ?? []
  if (!rows.length) continue
  // Prisma rejects explicit nulls for JSON columns in createMany; leaving them out stores NULL.
  const clean = rows.map((r) => Object.fromEntries(Object.entries(r).filter(([k, v]) => !(v === null && ['before', 'after', 'snapshot', 'selection', 'gases', 'totals', 'parameters'].includes(k)))))
  const delegate = db[model] as unknown as { createMany: (a: { data: Row[]; skipDuplicates: boolean }) => Promise<{ count: number }> }
  const { count } = await delegate.createMany({ data: clean, skipDuplicates: true })
  counts.push(`${model} ${count}/${rows.length}`)
}
console.log(`Imported from ${file}: ${counts.join(', ')}`)
if (data.evidence?.length) console.log('Note: evidence rows were imported, but their files are not in the export. Copy the storage folder too.')
await db.$disconnect()
