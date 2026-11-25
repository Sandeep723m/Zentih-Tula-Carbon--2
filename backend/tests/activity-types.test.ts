import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { seedReferenceData } from '../src/calc/referenceData.js'
import { makeOrg, makeUser, signInAs, signInSuperAdmin, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
const DIESEL = 'A-ST-DIESEL-GAS-OIL'
type Client = Awaited<ReturnType<typeof signInAs>>
let sa: Client, tenant: Client, orgId = '', periodId = ''

before(async () => {
  const org = await makeOrg('Formula Co'); orgId = org.id
  sa = await signInSuperAdmin(base)
  tenant = await signInAs(base, org.id, 'TENANT_ADMIN')
  const u = await makeUser()
  const f = await db.facility.create({ data: { organizationId: org.id, code: 'PA', name: 'Plant A' } })
  const p = await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'FY', startDate: new Date('2024-04-01'), endDate: new Date('2025-03-31') } }); periodId = p.id
  const s = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: f.id, name: 'DG set', category: 'FUEL_COMBUSTION', activityCode: DIESEL } })
  await db.activityRecord.create({ data: { organizationId: org.id, facilityId: f.id, reportingPeriodId: p.id, emissionSourceId: s.id, startDate: new Date('2024-04-01'), endDate: new Date('2024-04-30'), quantity: '1000', unit: 'l', parameters: { density: '0.84', densityUnit: 'kg/l' }, status: 'APPROVED', createdById: u.id, updatedById: u.id } })
})

test('only Super Admins see or change formulas and units', async () => {
  assert.equal((await tenant.get('/api/platform/activity-types')).status, 403)
  assert.equal((await tenant.patch(`/api/platform/activity-types/${DIESEL}`, { formulaCode: 'C-03', allowedUnits: ['l'], reason: 'test change' })).status, 403)
  const list = await sa.get('/api/platform/activity-types?q=diesel')
  assert.equal(list.status, 200)
  assert.ok(list.body.rows.some((r: { code: string; formulaCode: string; changed: boolean }) => r.code === DIESEL && r.formulaCode === 'C-01' && !r.changed))
  const d = (await sa.get(`/api/platform/activity-types/${DIESEL}`)).body
  assert.equal(d.formulaCode, 'C-01')
  assert.ok(d.equation.length > 0)
  assert.deepEqual(d.options.formulas.map((f: { code: string | null }) => f.code), ['C-01', 'C-03', null])
  assert.equal(d.usage.byUnit.l, 1)
})

test('refuses changes that would break calculations or existing records', async () => {
  const d = (await sa.get(`/api/platform/activity-types/${DIESEL}`)).body
  const patch = (b: object) => sa.patch(`/api/platform/activity-types/${DIESEL}`, { formulaCode: 'C-01', allowedUnits: d.allowedUnits, reason: 'Checking the rules', ...b })
  assert.equal((await patch({ formulaCode: 'C-06' })).status, 400) // electricity formula for a fuel
  assert.equal((await patch({ allowedUnits: [...d.allowedUnits, 'kg BOD'] })).status, 400) // C-01 cannot convert it
  assert.equal((await patch({ allowedUnits: [...d.allowedUnits, 'km'] })).status, 400) // distance needs C-03
  assert.equal((await patch({ allowedUnits: d.allowedUnits.filter((u: string) => u !== 'l') })).status, 400) // a record uses litres
  assert.equal((await patch({ allowedUnits: [...d.allowedUnits, 'SCM'] })).status, 400) // diesel is not a gas
  assert.equal((await patch({ reason: '' })).status, 400)
  assert.equal((await patch({})).status, 400) // nothing changed
})

test('a change is recorded, used by the next calculation, kept by a reseed, and can be restored', async () => {
  const d = (await sa.get(`/api/platform/activity-types/${DIESEL}`)).body
  const changed = await sa.patch(`/api/platform/activity-types/${DIESEL}`, { formulaCode: 'C-03', allowedUnits: [...d.allowedUnits, 'km'], reason: 'Generators are mounted on trucks at this client' })
  assert.equal(changed.status, 200)
  assert.equal(changed.body.changed, true)
  assert.equal(changed.body.history[0].reason, 'Generators are mounted on trucks at this client')

  await seedReferenceData(db) // a redeploy's reference refresh keeps the Super Admin's choice
  assert.equal((await db.activityType.findUniqueOrThrow({ where: { code: DIESEL } })).formulaCode, 'C-03')

  const run = await tenant.post('/api/calculations/runs', { reportingPeriodId: periodId, gwpSet: 'AR6' })
  assert.equal(run.status, 201)
  const results = await db.calculationResult.findMany({ where: { organizationId: orgId } })
  assert.deepEqual(results.map((r) => r.formulaCode), ['C-03'])

  const restored = await sa.patch(`/api/platform/activity-types/${DIESEL}`, { formulaCode: d.workbook.formulaCode, allowedUnits: d.workbook.allowedUnits, reason: 'Back to the workbook' })
  assert.equal(restored.status, 200)
  assert.equal(restored.body.changed, false)
  const actions = await db.auditLog.findMany({ where: { entityType: 'ActivityType', entityId: DIESEL }, orderBy: { createdAt: 'asc' } })
  assert.deepEqual(actions.map((a) => a.action), ['activity_type.updated', 'activity_type.restored'])
  // The earlier result keeps the formula it was calculated with.
  assert.equal((await db.calculationResult.findFirstOrThrow({ where: { organizationId: orgId } })).formulaCode, 'C-03')
})
