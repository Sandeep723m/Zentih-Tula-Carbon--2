// Imports the six static Zenith Energy Services prototype records into the local
// Zenith Testing sandbox. Stable IDs make this safe to rerun without duplicates.
import { getPrisma } from '../src/config/database.js'

const db = getPrisma()
const org = await db.organization.findFirstOrThrow({ where: { name: 'Zenith Testing' } })
const entry = await db.user.findUniqueOrThrow({ where: { email: 'dataentry@zenithtesting.in' } })
const reviewer = await db.user.findUniqueOrThrow({ where: { email: 'reviewer@zenithtesting.in' } })
const period = await db.reportingPeriod.findUniqueOrThrow({ where: { organizationId_name: { organizationId: org.id, name: 'FY 2025-26' } } })

const site = await db.site.upsert({
  where: { organizationId_code: { organizationId: org.id, code: 'ZES' } },
  update: {},
  create: { organizationId: org.id, code: 'ZES', name: 'Zenith Energy Services', country: 'India' },
})

const chennai = await db.facility.upsert({
  where: { organizationId_code: { organizationId: org.id, code: 'ZES-CHN' } },
  update: {},
  create: { organizationId: org.id, siteId: site.id, code: 'ZES-CHN', name: 'Chennai Plant 1', country: 'India', city: 'Sriperumbudur', gridLocation: 'India - Southern Grid' },
})
const pune = await db.facility.upsert({
  where: { organizationId_code: { organizationId: org.id, code: 'ZES-PUN' } },
  update: {},
  create: { organizationId: org.id, siteId: site.id, code: 'ZES-PUN', name: 'Pune Warehouse', country: 'India', city: 'Pune', gridLocation: 'India - Western Grid' },
})

const sourceSpecs = [
  { key: 'grid-chennai', facility: chennai, name: 'Grid electricity', category: 'PURCHASED_ELECTRICITY' as const, unit: 'kWh' },
  { key: 'diesel-chennai', facility: chennai, name: 'Diesel generator', category: 'FUEL_COMBUSTION' as const, unit: 'Litres' },
  { key: 'refrigerant-chennai', facility: chennai, name: 'Refrigerant top-up', category: 'FUGITIVE_GAS' as const, unit: 'kg' },
  { key: 'grid-pune', facility: pune, name: 'Grid electricity', category: 'PURCHASED_ELECTRICITY' as const, unit: 'kWh' },
  { key: 'diesel-pune', facility: pune, name: 'Backup Generator', category: 'FUEL_COMBUSTION' as const, unit: 'Litres' },
]
const sources = new Map<string, string>()
for (const spec of sourceSpecs) {
  const source = await db.emissionSource.upsert({
    where: { facilityId_name: { facilityId: spec.facility.id, name: spec.name } },
    update: {},
    create: { organizationId: org.id, facilityId: spec.facility.id, name: spec.name, category: spec.category, defaultUnit: spec.unit, isActive: true },
  })
  sources.set(spec.key, source.id)
}

const records = [
  { key: 'ACT-2025-0812', source: 'grid-chennai', facility: chennai, date: '2025-08-12', quantity: '48200', unit: 'kWh', status: 'APPROVED' as const, notes: 'Imported prototype sample. Mock estimate: 39.524 tCO2e; factor 0.82 kg CO2e/kWh. Evidence filename listed in prototype; file not provided.' },
  { key: 'ACT-2025-0815', source: 'diesel-chennai', facility: chennai, date: '2025-08-15', quantity: '320', unit: 'Litres', status: 'SUBMITTED' as const, notes: 'Imported prototype sample. Mock estimate: 0.858 tCO2e; factor 2.68 kg CO2e/L. Evidence filename listed in prototype; file not provided.' },
  { key: 'ACT-2025-0818', source: 'grid-pune', facility: pune, date: '2025-08-18', quantity: '12050', unit: 'kWh', status: 'DRAFT' as const, notes: 'Imported prototype sample. Mock estimate: 9.881 tCO2e; factor 0.82 kg CO2e/kWh.' },
  { key: 'ACT-2025-0820', source: 'refrigerant-chennai', facility: chennai, date: '2025-08-20', quantity: '4.2', unit: 'kg', status: 'DRAFT' as const, notes: 'Imported prototype sample; prototype status was Error. Validation notes: Missing required HVAC maintenance service log sheet. Unit specified as kg but batch ticket was recorded in pounds (lbs); verify conversion. Mock estimate: 8.770 tCO2e; factor 2088 kg CO2e/kg.' },
  { key: 'ACT-2025-0822', source: 'diesel-pune', facility: pune, date: '2025-08-22', quantity: '180', unit: 'Litres', status: 'APPROVED' as const, notes: 'Imported prototype sample. Mock estimate: 0.482 tCO2e; factor 2.68 kg CO2e/L. Evidence filename listed in prototype; file not provided.' },
  { key: 'ACT-2025-0824', source: 'grid-chennai', facility: chennai, date: '2025-08-24', quantity: '51300', unit: 'kWh', status: 'APPROVED' as const, notes: 'Imported prototype sample. Mock estimate: 42.066 tCO2e; factor 0.82 kg CO2e/kWh. Evidence filename listed in prototype; file not provided.' },
]

for (const [i, item] of records.entries()) {
  const id = `a0e20000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`
  const date = new Date(`${item.date}T00:00:00.000Z`)
  const submittedAt = item.status === 'DRAFT' ? null : new Date(`${item.date}T10:00:00.000Z`)
  const reviewedAt = item.status === 'APPROVED' ? new Date(`${item.date}T12:00:00.000Z`) : null
  await db.activityRecord.upsert({
    where: { id },
    update: {},
    create: {
      id, organizationId: org.id, facilityId: item.facility.id, reportingPeriodId: period.id,
      emissionSourceId: sources.get(item.source)!, startDate: date, endDate: date,
      quantity: item.quantity, unit: item.unit, notes: item.notes, status: item.status,
      submittedAt, reviewedById: reviewedAt ? reviewer.id : null, reviewedAt,
      createdById: entry.id, updatedById: entry.id,
    },
  })
}

const imported = await db.activityRecord.findMany({
  where: { id: { in: records.map((_, i) => `a0e20000-0000-4000-8000-${String(i + 1).padStart(12, '0')}`) }, organizationId: org.id },
  select: { status: true },
})
const statusCounts = imported.reduce<Record<string, number>>((counts, row) => {
  counts[row.status] = (counts[row.status] ?? 0) + 1
  return counts
}, {})
console.log(`Verified ${imported.length} imported records in Zenith Testing (${JSON.stringify(statusCounts)}).`)
await db.$disconnect()
