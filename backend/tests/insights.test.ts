import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { makeOrg, makeUser, signInAs, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
type Client = Awaited<ReturnType<typeof signInAs>>
let admin: Client, entry: Client, foreign: Client
let p1 = '', p2 = '', plantA = '', dieselId = ''

// One period's results, written straight into a run: insights read results, they never run the engine.
async function period(orgId: string, userId: string, name: string, from: string, to: string, values: Array<[string, string, string, number]>) {
  const p = await db.reportingPeriod.create({ data: { organizationId: orgId, name, startDate: new Date(from), endDate: new Date(to) } })
  const run = await db.calculationRun.create({ data: { organizationId: orgId, reportingPeriodId: p.id, engineVersion: 'test', recordCount: 0, calculatedCount: 0, blockedCount: 0, notCalculableCount: 0, scope2LocationTCO2e: '0', runById: userId } })
  for (const [sourceId, facilityId, line, t] of values) {
    const rec = await db.activityRecord.create({ data: { organizationId: orgId, facilityId, reportingPeriodId: p.id, emissionSourceId: sourceId, startDate: new Date(from), endDate: new Date(to), quantity: '1', unit: 'l', createdById: userId, updatedById: userId, status: 'APPROVED' } })
    await db.calculationResult.create({ data: { runId: run.id, organizationId: orgId, activityRecordId: rec.id, facilityId, formulaCode: 'C-01', line, status: 'CALCULATED', inputs: {}, tCO2e: String(t), issues: [] } })
  }
  return p.id
}

before(async () => {
  const org = await makeOrg('Insight Co')
  admin = await signInAs(base, org.id, 'TENANT_ADMIN')
  entry = await signInAs(base, org.id, 'DATA_ENTRY')
  foreign = await signInAs(base, (await makeOrg('Other Insight')).id, 'TENANT_ADMIN')
  const u = await makeUser()
  const a = await db.facility.create({ data: { organizationId: org.id, code: 'PA', name: 'Plant A' } })
  plantA = a.id
  const diesel = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: a.id, name: 'DG set', category: 'FUEL_COMBUSTION' } })
  const grid = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: a.id, name: 'Grid', category: 'PURCHASED_ELECTRICITY' } })
  const gas = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: a.id, name: 'Chiller', category: 'FUGITIVE_GAS' } })
  dieselId = diesel.id
  p1 = await period(org.id, u.id, 'FY 2023-24', '2023-04-01', '2024-03-31', [[diesel.id, a.id, 'SCOPE1', 100], [grid.id, a.id, 'SCOPE2_LOCATION', 200], [grid.id, a.id, 'SCOPE2_MARKET', 150], [gas.id, a.id, 'SCOPE1', 20]])
  p2 = await period(org.id, u.id, 'FY 2024-25', '2024-04-01', '2025-03-31', [[diesel.id, a.id, 'SCOPE1', 80], [grid.id, a.id, 'SCOPE2_LOCATION', 190]])
})

test('overview totals keep location- and market-based apart, and recommendations come from the data with their assumptions', async () => {
  const r = await admin.get(`/api/insights/overview?reportingPeriodId=${p1}`)
  assert.equal(r.status, 200)
  assert.deepEqual([r.body.totals.scope1, r.body.totals.scope2Location, r.body.totals.scope2Market, r.body.totals.headline], [120, 200, 150, 320])
  const keys = r.body.recommendations.map((x: { key: string }) => x.key)
  assert.ok(keys.includes(`fuel:${dieselId}`)); assert.ok(keys.includes(`elec:${plantA}`)); assert.ok(keys.includes('fugitive'))
  const fuel = r.body.recommendations.find((x: { key: string }) => x.key === `fuel:${dieselId}`)
  assert.equal(fuel.estimatedReductionTCO2e, 10); assert.match(fuel.assumptions, /10%/); assert.match(fuel.limitations, /not a guaranteed/)
})

test('a scenario projects changes without touching official data, and can be saved and compared', async () => {
  const before = await db.calculationResult.findMany({ orderBy: { id: 'asc' } })
  const sim = await admin.post('/api/insights/simulate', { reportingPeriodId: p1, adjustments: [{ target: 'source', key: dieselId, percent: -20 }, { target: 'category', key: 'PURCHASED_ELECTRICITY', percent: -15 }] })
  assert.equal(sim.status, 200)
  assert.equal(sim.body.hypothetical, true)
  assert.equal(sim.body.after.headline, 320 - 20 - 30)
  assert.equal(sim.body.reduction, 50)
  assert.equal(sim.body.byScope.find((s: { label: string }) => s.label.includes('market')).after, 127.5)
  assert.deepEqual(await db.calculationResult.findMany({ orderBy: { id: 'asc' } }), before)
  assert.equal((await admin.post('/api/insights/scenarios', { name: 'Diesel and power', reportingPeriodId: p1, adjustments: [{ target: 'source', key: dieselId, percent: -20 }] })).status, 201)
  const list = await admin.get('/api/insights/scenarios')
  assert.equal(list.body[0].reduction, 20)
  assert.equal((await admin.post('/api/insights/simulate', { reportingPeriodId: p1, adjustments: [{ target: 'source', key: dieselId, percent: -150 }] })).status, 400)
})

test('intensity divides by the stated denominator; zero is refused', async () => {
  assert.equal((await admin.put('/api/insights/intensity', { reportingPeriodId: p1, metric: 'PRODUCTION', label: 'Tonnes of product', value: '0', unit: 't' })).status, 400)
  assert.equal((await admin.put('/api/insights/intensity', { reportingPeriodId: p1, facilityId: plantA, metric: 'PRODUCTION', label: 'Tonnes of product', value: '64', unit: 't' })).status, 204)
  assert.equal((await admin.put('/api/insights/intensity', { reportingPeriodId: p1, facilityId: plantA, metric: 'PRODUCTION', label: 'Tonnes of product', value: '160', unit: 't' })).status, 204) // updates, not duplicates
  const m = (await admin.get(`/api/insights/overview?reportingPeriodId=${p1}`)).body.intensities
  assert.equal(m.length, 1); assert.equal(m[0].total, 2); assert.equal(m[0].scope1, 0.75)
})

test('a target uses the baseline from results, tracks progress, and keeps every baseline revision', async () => {
  const t = await admin.post('/api/insights/targets', { name: '30% by 2030', baselinePeriodId: p1, scope: 'ALL', targetYear: 2030, reductionPercent: 30 })
  assert.equal(t.status, 201)
  let list = (await admin.get('/api/insights/targets')).body
  assert.equal(Number(list[0].baselineTCO2e), 320); assert.equal(list[0].goal, 224)
  const fy25 = list[0].progress.find((x: { period: string }) => x.period === 'FY 2024-25')
  assert.equal(fy25.actual, 270); assert.equal(fy25.onTrack, true)
  assert.equal((await admin.post(`/api/insights/targets/${t.body.id}/rebaseline`, { reason: '' })).status, 400)
  assert.equal((await admin.post(`/api/insights/targets/${t.body.id}/rebaseline`, { reason: 'Corrected meter error' })).status, 204)
  list = (await admin.get('/api/insights/targets')).body
  assert.deepEqual(list[0].revisions.map((r: { reason: string }) => r.reason), ['Original baseline', 'Corrected meter error'])
})

test('data entry and other organisations cannot use it', async () => {
  assert.equal((await entry.get(`/api/insights/overview?reportingPeriodId=${p1}`)).status, 403)
  assert.equal((await foreign.get(`/api/insights/overview?reportingPeriodId=${p1}`)).status, 404)
  assert.equal((await foreign.post('/api/insights/simulate', { reportingPeriodId: p1, adjustments: [{ target: 'category', key: 'X', percent: 1 }] })).status, 404)
  assert.ok(!(await foreign.get('/api/insights/targets')).body.length)
  void p2
})
