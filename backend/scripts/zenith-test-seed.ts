// Creates the "Zenith Testing" sandbox org, its five logins and a small activity demo. NON-DESTRUCTIVE:
// every fixture has a stable ID and existing organisations, users and records are left untouched.
// Safe to run repeatedly.
//   npm run zenith:seed        (local)   /   npm run zenith:seed:prod   (built, on the server)
//
// The four role accounts are reachable by the right-edge quick-switch (TEST_SWITCH=true) and by normal
// login. The Super Admin is reachable by NORMAL LOGIN ONLY — it is never in the quick-switch, because a
// platform admin can see every customer org. These passwords are fixed on purpose (sandbox test org).
import { hashPassword } from '../src/auth/crypto.js'
import { seedReferenceData } from '../src/calc/referenceData.js'
import { getPrisma } from '../src/config/database.js'
import { ZENITH_ORG_NAME, ZENITH_ROLES } from '../src/controllers/test-switch.controller.js'

const SUPER = { email: 'superadmin@zenithtesting.in', name: 'Zenith Super Admin', password: '2GEb4457mkYcQy' }
const PASSWORDS: Record<string, string> = {
  'tenant@zenithtesting.in': 'Hc7t6iSZQM2YKX',
  'dataentry@zenithtesting.in': 'P4eXgPcfvEASjo',
  'reviewer@zenithtesting.in': 'qFmisKEn7vboVB',
  'verifier@zenithtesting.in': 'YvazxWtzFRtpgS',
}

const db = getPrisma()
await seedReferenceData(db)
const upsertUser = async (email: string, name: string, password: string, platformRole: 'SUPER_ADMIN' | null) => {
  const data = { name, platformRole, isActive: true, mustChangePassword: false, mfaEnabled: false, mfaSecret: null, mfaLastStep: null, failedLoginCount: 0, lockedUntil: null }
  return db.user.upsert({ where: { email }, update: data, create: { email, passwordHash: await hashPassword(password), ...data } })
}

const org = await db.organization.findFirst({ where: { name: ZENITH_ORG_NAME } })
  ?? await db.organization.create({ data: { name: ZENITH_ORG_NAME, legalName: 'Zenith Testing', country: 'India', subscription: { create: { planName: 'Testing', status: 'ACTIVE', startDate: new Date() } } } })

await upsertUser(SUPER.email, SUPER.name, SUPER.password, 'SUPER_ADMIN')

// Super Admin is created above; the loop handles the four org-membership roles only.
for (const a of ZENITH_ROLES.filter((r) => r.id !== 'super')) {
  const user = await upsertUser(a.email, `Zenith ${a.label}`, PASSWORDS[a.email], null)
  await db.membership.upsert({
    where: { userId_organizationId: { userId: user.id, organizationId: org.id } },
    update: { role: a.role },
    create: { userId: user.id, organizationId: org.id, role: a.role },
  })
}

// A minimal, screenshot-friendly sandbox: 13 activity records in FY 2024-25, plus the open
// FY 2025-26 period shown in the app header. Re-running this seed will never reset edited records.
const tenant = await db.user.findUniqueOrThrow({ where: { email: 'tenant@zenithtesting.in' } })
const entry = await db.user.findUniqueOrThrow({ where: { email: 'dataentry@zenithtesting.in' } })
const reviewer = await db.user.findUniqueOrThrow({ where: { email: 'reviewer@zenithtesting.in' } })

const facility = await db.facility.upsert({
  where: { id: 'a0e10000-0000-4000-8000-000000000101' },
  update: {},
  create: {
    id: 'a0e10000-0000-4000-8000-000000000101', organizationId: org.id,
    name: 'T1 — ZET', code: 'T1', country: 'India', city: 'Chennai',
    gridLocation: 'India - National Average', equityShare: 100, scope1Active: true, scope2Active: true,
  },
})

const getPeriod = async (name: string, startDate: string, endDate: string, id: string) => {
  const existing = await db.reportingPeriod.findUnique({ where: { organizationId_name: { organizationId: org.id, name } } })
  return existing ?? db.reportingPeriod.create({ data: {
    id, organizationId: org.id, name,
    startDate: new Date(`${startDate}T00:00:00.000Z`), endDate: new Date(`${endDate}T00:00:00.000Z`), status: 'OPEN',
  } })
}
const fy2425 = await getPeriod('FY 2024-25', '2024-04-01', '2025-03-31', 'a0e10000-0000-4000-8000-000000000102')
await getPeriod('FY 2025-26', '2025-04-01', '2026-03-31', 'a0e10000-0000-4000-8000-000000000103')

const sourceSpecs = [
  { key: 'grid', name: 'Purchased electricity grid', code: 'A-GRID', category: 'PURCHASED_ELECTRICITY', unit: 'kWh' },
  { key: 'coal', name: 'Coal - supplier NCV and CO2', code: 'A-COAL', category: 'FUEL_COMBUSTION', unit: 'kg' },
  { key: 'dieselFleet', name: 'Diesel for owned fleet', code: 'A-MO-DIESEL', category: 'FUEL_COMBUSTION', unit: 'l' },
  { key: 'dieselGenerator', name: 'DG Set', code: 'A-ST-DIESEL-GAS-OIL', category: 'FUEL_COMBUSTION', unit: 'l' },
  { key: 'dieselKilolitre', name: 'Diesel - unit conversion kL', code: 'A-MO-DIESEL', category: 'FUEL_COMBUSTION', unit: 'l' },
  { key: 'petrol', name: 'Petrol - IPCC default', code: 'A-MO-PETROL-GASOL', category: 'FUEL_COMBUSTION', unit: 'l' },
  { key: 'lpgMass', name: 'LPG - IPCC default (mass entry)', code: 'A-ST-LPG', category: 'FUEL_COMBUSTION', unit: 'kg' },
  { key: 'lpgSupplier', name: 'LPG - supplier NCV and CO2', code: 'A-ST-LPG', category: 'FUEL_COMBUSTION', unit: 'kg' },
  { key: 'petrolSupplier', name: 'Petrol - supplier density, NCV, CO2', code: 'A-MO-PETROL-GASOL', category: 'FUEL_COMBUSTION', unit: 'l' },
  { key: 'woodWaste', name: 'Wood waste - IPCC default (biogenic)', code: 'A-ST-WOOD-WOOD-WASTE', category: 'FUEL_COMBUSTION', unit: 'kg' },
  { key: 'woodChips', name: 'Wood chips - supplier density and NCV (biogenic)', code: 'A-ST-WOOD-WOOD-WASTE', category: 'FUEL_COMBUSTION', unit: 'kg' },
  { key: 'boilerBiomass', name: 'Boiler Biomass', code: 'A-ST-WOOD-WOOD-WASTE', category: 'FUEL_COMBUSTION', unit: 'kg' },
] as const

const sources = new Map<string, string>()
for (const [index, spec] of sourceSpecs.entries()) {
  const existing = await db.emissionSource.findFirst({ where: { facilityId: facility.id, name: spec.name } })
  const source = existing ?? await db.emissionSource.create({ data: {
    id: `a0e10000-0000-4000-8000-${String(index + 201).padStart(12, '0')}`,
    organizationId: org.id, facilityId: facility.id, name: spec.name,
    category: spec.category, activityCode: spec.code, defaultUnit: spec.unit, isActive: true,
  } })
  sources.set(spec.key, source.id)
}

const records = [
  { key: 'grid', quantity: '539760', unit: 'kWh', start: '2024-06-01', end: '2024-10-01', status: 'APPROVED', by: 'tenant' },
  { key: 'grid', quantity: '250', unit: 'MWh', start: '2024-04-01', end: '2025-03-13', status: 'RETURNED', by: 'entry', reason: 'Please check the invoice total before resubmitting.' },
  { key: 'coal', quantity: '1000', unit: 'kg', start: '2024-04-01', end: '2025-03-31', status: 'APPROVED', by: 'entry' },
  { key: 'dieselFleet', quantity: '1000', unit: 'l', start: '2024-04-01', end: '2025-03-31', status: 'APPROVED', by: 'entry' },
  { key: 'dieselGenerator', quantity: '1000', unit: 'l', start: '2024-04-01', end: '2025-03-31', status: 'APPROVED', by: 'tenant' },
  { key: 'dieselKilolitre', quantity: '5', unit: 'kl', start: '2024-04-01', end: '2025-03-31', status: 'APPROVED', by: 'tenant' },
  { key: 'petrol', quantity: '2000', unit: 'l', start: '2024-04-01', end: '2025-03-31', status: 'APPROVED', by: 'tenant' },
  { key: 'lpgMass', quantity: '1500', unit: 'kg', start: '2024-04-01', end: '2025-03-31', status: 'APPROVED', by: 'tenant' },
  { key: 'lpgSupplier', quantity: '2', unit: 't', start: '2024-04-01', end: '2025-03-31', status: 'APPROVED', by: 'entry' },
  { key: 'petrolSupplier', quantity: '2000', unit: 'l', start: '2024-04-01', end: '2025-03-31', status: 'APPROVED', by: 'tenant' },
  { key: 'woodWaste', quantity: '5000', unit: 'kg', start: '2024-04-01', end: '2025-03-31', status: 'APPROVED', by: 'tenant' },
  { key: 'woodChips', quantity: '50000', unit: 'kg', start: '2024-04-01', end: '2025-03-31', status: 'APPROVED', by: 'entry' },
  { key: 'boilerBiomass', quantity: '50000', unit: 'kg', start: '2024-04-01', end: '2024-04-30', status: 'DRAFT', by: 'tenant' },
] as const

for (const [index, item] of records.entries()) {
  const id = `a0e10000-0000-4000-8000-${String(index + 301).padStart(12, '0')}`
  const creator = item.by === 'tenant' ? tenant : entry
  const submittedAt = item.status === 'DRAFT' ? null : new Date(`2025-04-${String(Math.min(index + 1, 28)).padStart(2, '0')}T10:00:00.000Z`)
  const reviewedAt = item.status === 'APPROVED' || item.status === 'RETURNED'
    ? new Date(`2025-04-${String(Math.min(index + 2, 28)).padStart(2, '0')}T10:00:00.000Z`) : null
  await db.activityRecord.upsert({
    where: { id }, update: {}, create: {
      id, organizationId: org.id, facilityId: facility.id, reportingPeriodId: fy2425.id,
      emissionSourceId: sources.get(item.key)!, startDate: new Date(`${item.start}T00:00:00.000Z`),
      endDate: new Date(`${item.end}T00:00:00.000Z`), quantity: item.quantity, unit: item.unit,
      notes: 'Local demo record.', status: item.status, submittedAt, reviewedAt,
      reviewedById: reviewedAt ? reviewer.id : null, returnReason: 'reason' in item ? item.reason : null,
      createdById: creator.id, updatedById: creator.id,
    },
  })

  if (item.status !== 'DRAFT') {
    const submittedId = `a0e10000-0000-4000-8001-${String(index + 301).padStart(12, '0')}`
    await db.activityReview.upsert({
      where: { id: submittedId }, update: {}, create: {
        id: submittedId, organizationId: org.id, activityRecordId: id, action: 'SUBMITTED',
        fromStatus: 'DRAFT', toStatus: 'SUBMITTED', actorId: creator.id, createdAt: submittedAt!,
      },
    })
    const reviewId = `a0e10000-0000-4000-8002-${String(index + 301).padStart(12, '0')}`
    const approved = item.status === 'APPROVED'
    await db.activityReview.upsert({
      where: { id: reviewId }, update: {}, create: {
        id: reviewId, organizationId: org.id, activityRecordId: id,
        action: approved ? 'APPROVED' : 'RETURNED', fromStatus: 'SUBMITTED', toStatus: item.status,
        actorId: reviewer.id, comment: approved ? null : ('reason' in item ? item.reason : null), createdAt: reviewedAt!,
      },
    })
  }
}

console.log(`Zenith Testing ready: ${ZENITH_ROLES.map((a) => a.role).join(', ')} + Super Admin (normal login only), 13 demo activity records.`)
await db.$disconnect()
