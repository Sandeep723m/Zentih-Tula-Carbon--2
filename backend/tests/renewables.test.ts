import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { makeOrg, makeUser, signInAs, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
type Client = Awaited<ReturnType<typeof signInAs>>
let admin: Client, reviewer: Client, entry: Client, foreign: Client
let periodId = '', recId = '', fuelRecId = ''

before(async () => {
  const org = await makeOrg('Green Co')
  admin = await signInAs(base, org.id, 'TENANT_ADMIN')
  reviewer = await signInAs(base, org.id, 'REVIEWER')
  entry = await signInAs(base, org.id, 'DATA_ENTRY')
  foreign = await signInAs(base, (await makeOrg('Green Other')).id, 'TENANT_ADMIN')
  const u = await makeUser()
  const f = await db.facility.create({ data: { organizationId: org.id, code: 'PA', name: 'Plant A', country: 'India' } })
  const p = await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'FY 2023-24', startDate: new Date('2023-04-01'), endDate: new Date('2024-03-31') } })
  periodId = p.id
  const grid = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: f.id, name: 'Grid', category: 'PURCHASED_ELECTRICITY' } })
  const dg = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: f.id, name: 'DG', category: 'FUEL_COMBUSTION' } })
  const rec = (s: string, q: string, unit: string) => db.activityRecord.create({ data: { organizationId: org.id, facilityId: f.id, reportingPeriodId: p.id, emissionSourceId: s, startDate: new Date('2023-10-01'), endDate: new Date('2023-10-31'), quantity: q, unit, createdById: u.id, updatedById: u.id } })
  recId = (await rec(grid.id, '225000', 'kWh')).id
  fuelRecId = (await rec(dg.id, '100', 'l')).id
})

const register = (c: Client, body: Record<string, unknown>) => c.post('/api/renewables', { type: 'I_REC', quantityMWh: '200', generationFrom: '2023-06-01', generationTo: '2023-12-31', country: 'India', ...body })

test('instruments are registered once, allocated within their quantity and the consumption, and never change records', async () => {
  const before = await db.activityRecord.findUniqueOrThrow({ where: { id: recId } })
  const a = await register(admin, { reference: 'IREC-1' })
  assert.equal(a.status, 201)
  assert.equal((await register(admin, { reference: 'IREC-1' })).status, 409)
  assert.equal((await register(admin, { reference: 'IREC-BAD', generationFrom: '2024-01-01', generationTo: '2023-01-01' })).status, 400)
  assert.equal((await admin.post(`/api/renewables/${a.body.id}/allocations`, { activityRecordId: fuelRecId, mwh: '10' })).status, 400) // electricity only
  assert.equal((await admin.post(`/api/renewables/${a.body.id}/allocations`, { activityRecordId: recId, mwh: '250' })).status, 400) // more than the certificate
  assert.equal((await admin.post(`/api/renewables/${a.body.id}/allocations`, { activityRecordId: recId, mwh: '150' })).status, 204)
  assert.equal((await admin.post(`/api/renewables/${a.body.id}/allocations`, { activityRecordId: recId, mwh: '10' })).status, 409) // once per record
  const b = await register(admin, { reference: 'IREC-2', quantityMWh: '500' })
  assert.equal((await admin.post(`/api/renewables/${b.body.id}/allocations`, { activityRecordId: recId, mwh: '100' })).status, 400) // record used 225 MWh, 150 covered
  assert.deepEqual(await db.activityRecord.findUniqueOrThrow({ where: { id: recId } }), before)
})

test('a claim counts only when every criterion passes: retired for you, right vintage, same market', async () => {
  let s = (await reviewer.get(`/api/renewables/summary?reportingPeriodId=${periodId}`)).body
  assert.equal(s.consumptionMWh, 225); assert.equal(s.coveredMWh, 0); assert.equal(s.ineligibleMWh, 150)
  const row = s.rows.find((r: { id: string }) => r.id === recId)
  assert.ok(row.allocations[0].checks.some((c: { code: string; ok: boolean }) => c.code === 'RETIRED' && !c.ok))
  const id = (await admin.get('/api/renewables')).body.rows.find((r: { reference: string }) => r.reference === 'IREC-1').id
  assert.equal((await admin.post(`/api/renewables/${id}/retire`, { retiredAt: '2024-02-01', retiredForOrg: true })).status, 204)
  s = (await reviewer.get(`/api/renewables/summary?reportingPeriodId=${periodId}`)).body
  assert.equal(s.coveredMWh, 150); assert.equal(s.notCoveredMWh, 75)
  assert.equal(s.rows.find((r: { id: string }) => r.id === recId).matchesRecord, false) // record's market-based input not yet updated
  // An instrument from another market does not qualify even when retired.
  const other = await register(admin, { reference: 'REC-US', country: 'United States', retiredAt: '2024-01-01', retiredForOrg: true, quantityMWh: '50' })
  await admin.post(`/api/renewables/${other.body.id}/allocations`, { activityRecordId: recId, mwh: '50' })
  s = (await reviewer.get(`/api/renewables/summary?reportingPeriodId=${periodId}`)).body
  assert.equal(s.coveredMWh, 150); assert.equal(s.ineligibleMWh, 50)
})

test('only Tenant Admins manage; data entry and other organisations have no access', async () => {
  assert.equal((await register(reviewer, { reference: 'X' })).status, 403)
  assert.equal((await entry.get('/api/renewables')).status, 403)
  assert.ok(!(await foreign.get('/api/renewables')).body.rows.length)
  assert.equal((await foreign.get(`/api/renewables/summary?reportingPeriodId=${periodId}`)).status, 404)
})
