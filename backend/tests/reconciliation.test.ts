import assert from 'node:assert/strict'
import { after, before, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { makeOrg, makeUser, signInAs, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
type Client = Awaited<ReturnType<typeof signInAs>>
let entry: Client, reviewer: Client, verifier: Client, foreign: Client
let recordId = ''

before(async () => {
  const org = await makeOrg('Reconcile Co')
  entry = await signInAs(base, org.id, 'DATA_ENTRY')
  reviewer = await signInAs(base, org.id, 'REVIEWER')
  verifier = await signInAs(base, org.id, 'VERIFIER')
  foreign = await signInAs(base, (await makeOrg('Other')).id, 'TENANT_ADMIN')
  const u = await makeUser()
  const f = await db.facility.create({ data: { organizationId: org.id, code: 'PA', name: 'Plant A' } })
  const p = await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'FY', startDate: new Date('2023-04-01'), endDate: new Date('2024-03-31') } })
  const grid = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: f.id, name: 'Grid', category: 'PURCHASED_ELECTRICITY' } })
  const sub = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: f.id, name: 'Sub-meter', category: 'PURCHASED_ELECTRICITY' } })
  const rec = (s: string, q: string) => db.activityRecord.create({ data: { organizationId: org.id, facilityId: f.id, reportingPeriodId: p.id, emissionSourceId: s, startDate: new Date('2024-01-01'), endDate: new Date('2024-01-31'), quantity: q, unit: 'kWh', createdById: u.id, updatedById: u.id } })
  recordId = (await rec(grid.id, '11800')).id
  await rec(sub.id, '12350')
  // Same category and dates but another unit, or another activity: never compared (not in the items below).
  await db.activityRecord.create({ data: { organizationId: org.id, facilityId: f.id, reportingPeriodId: p.id, emissionSourceId: sub.id, startDate: new Date('2024-01-01'), endDate: new Date('2024-01-31'), quantity: '12', unit: 'MWh', createdById: u.id, updatedById: u.id } })
  const other = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: f.id, name: 'Supplier-specific supply', category: 'PURCHASED_ELECTRICITY', activityCode: 'A-GRID-OTH' } })
  await rec(other.id, '900')
  const bill = { documentType: 'ELECTRICITY_BILL', confidence: 0.9, documentNumber: 'B-1', quantity: '12000', unit: 'kWh', meterPrevious: '50000', meterCurrent: '62350' }
  const d = await db.intakeDocument.create({ data: { organizationId: org.id, fileName: 'jan.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'r1', storageKey: `rk-${org.id}`, uploadedById: u.id, status: 'EXTRACTED', result: { ...bill, invoices: [bill] } } })
  await db.intakeMatch.create({ data: { organizationId: org.id, documentId: d.id, invoiceIndex: 0, activityRecordId: recordId, withEvidence: true, matchedById: u.id } })
})

test('gathers the record, its bill, meter readings and overlapping records; shows differences; resolving never changes the record', async () => {
  const before = await db.activityRecord.findUniqueOrThrow({ where: { id: recordId } })
  const created = await entry.post(`/api/reconciliations/from-record/${recordId}`)
  assert.equal(created.status, 201)
  const id = created.body.id
  let r = (await entry.get(`/api/reconciliations/${id}`)).body
  assert.deepEqual(r.items.map((i: { kind: string; value: string }) => [i.kind, Number(i.value)]), [['RECORD', 11800], ['BILL', 12000], ['METER', 12350], ['OTHER_RECORD', 12350]])
  assert.equal(r.items[1].difference, 200)
  assert.ok(r.reasons.some((x: string) => /estimated reading/.test(x)))

  assert.equal((await entry.post(`/api/reconciliations/${id}/items`, { label: 'ERP export', value: '12010', unit: 'kWh' })).status, 204)
  assert.equal((await entry.post(`/api/reconciliations/${id}/resolve`, { value: '12350', explanation: 'Meter is actual' })).status, 403)
  assert.equal((await reviewer.post(`/api/reconciliations/${id}/resolve`, { value: '12350', explanation: '' })).status, 400)
  assert.equal((await reviewer.post(`/api/reconciliations/${id}/resolve`, { value: '12350', explanation: 'Bill used an estimated reading; meter is actual' })).status, 204)
  assert.equal((await entry.post(`/api/reconciliations/${id}/items`, { label: 'Late', value: '1', unit: 'kWh' })).status, 409)
  r = (await entry.get(`/api/reconciliations/${id}`)).body
  assert.equal(r.status, 'RESOLVED'); assert.equal(Number(r.resolvedValue), 12350)
  assert.deepEqual(r.history.map((h: { action: string }) => h.action), ['reconciliation.created', 'reconciliation.source_added', 'reconciliation.resolved'])
  assert.deepEqual(await db.activityRecord.findUniqueOrThrow({ where: { id: recordId } }), before)

  assert.equal((await reviewer.post(`/api/reconciliations/${id}/resolve?reopen=1`)).status, 204)
  assert.equal((await entry.get('/api/reconciliations?status=OPEN')).body.rows[0].spread, 550)
})

test('verifiers and other organisations have no access', async () => {
  assert.equal((await verifier.get('/api/reconciliations')).status, 403)
  assert.equal((await foreign.post(`/api/reconciliations/from-record/${recordId}`)).status, 404)
  const id = (await entry.get('/api/reconciliations')).body.rows[0].id
  assert.equal((await foreign.get(`/api/reconciliations/${id}`)).status, 404)
})
