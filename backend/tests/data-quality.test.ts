import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { makeOrg, makeUser, signInAs, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
type Client = Awaited<ReturnType<typeof signInAs>>
let admin: Client, entry: Client, verifier: Client, foreign: Client
let periodId = '', gridId = '', recId = ''

const month = (y: number, m: number) => [new Date(Date.UTC(y, m - 1, 1)), new Date(Date.UTC(y, m, 0))] as const

before(async () => {
  const org = await makeOrg('Quality Co')
  admin = await signInAs(base, org.id, 'TENANT_ADMIN')
  entry = await signInAs(base, org.id, 'DATA_ENTRY')
  verifier = await signInAs(base, org.id, 'VERIFIER')
  foreign = await signInAs(base, (await makeOrg('Elsewhere')).id, 'TENANT_ADMIN')
  const u = await makeUser()
  const a = await db.facility.create({ data: { organizationId: org.id, code: 'PA', name: 'Plant A' } })
  await db.facility.create({ data: { organizationId: org.id, code: 'PB', name: 'Plant B' } }) // no sources
  const p = await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'FY 2023-24', startDate: new Date('2023-04-01'), endDate: new Date('2024-03-31') } })
  periodId = p.id
  const grid = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: a.id, name: 'Grid', category: 'PURCHASED_ELECTRICITY', activityCode: 'A-GRID', defaultUnit: 'kWh' } })
  const grid2 = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: a.id, name: 'Grid meter 2', category: 'PURCHASED_ELECTRICITY', activityCode: 'A-GRID', defaultUnit: 'kWh' } })
  gridId = grid.id
  const rec = (sourceId: string, [s, e]: readonly [Date, Date], q: string) => db.activityRecord.create({ data: { organizationId: org.id, facilityId: a.id, reportingPeriodId: p.id, emissionSourceId: sourceId, startDate: s, endDate: e, quantity: q, unit: 'kWh', createdById: u.id, updatedById: u.id } })
  // April 2023 to January 2024 around 12,000 kWh, February missing, March 35,000 kWh.
  const steady = ['12000', '12500', '11800', '12200', '12100', '11900', '12300', '12000', '12400', '12100']
  for (const [i, q] of steady.entries()) { const r = await rec(grid.id, month(2023 + Math.floor((i + 3) / 12), ((i + 3) % 12) + 1), q); if (i === 0) recId = r.id }
  await rec(grid.id, month(2024, 3), '35000')
  await rec(grid2.id, month(2023, 4), '12000') // same facility, dates and quantity as the April bill
  await rec(grid2.id, month(2023, 5), '0')
})

const load = async (c: Client, extra = '') => (await c.get(`/api/data-quality?reportingPeriodId=${periodId}${extra}`))

describe('data quality', () => {
  test('finds gaps, the March spike, duplicates, zero quantities and facilities without sources; never changes data', async () => {
    const before = await db.activityRecord.findMany({ orderBy: { id: 'asc' } })
    const r = await load(admin, '&state=all')
    assert.equal(r.status, 200)
    const types = (t: string) => r.body.rows.filter((f: { type: string }) => f.type === t)
    assert.ok(types('MISSING_MONTH').some((f: { key: string }) => f.key === `MISSING_MONTH:${gridId}:2024-02`))
    const spike = types('ANOMALY').find((f: { key: string }) => f.key === `ANOMALY:${gridId}:2024-03`)
    assert.ok(spike); assert.equal(spike.severity, 'high'); assert.match(spike.detail, /35,000 kWh/)
    assert.ok(!types('ANOMALY').some((f: { key: string }) => f.key.endsWith('2023-12'))) // steady months are not flagged
    assert.equal(types('DUPLICATE_ENTRY').length, 1)
    assert.equal(types('INVALID_QUANTITY').length, 1)
    assert.equal(types('NO_SOURCES').length, 1)
    assert.equal(r.body.counts.records, 13); assert.equal(r.body.counts.missingEvidence, 13)
    assert.ok(r.body.byFacility[0].key.startsWith('PA'))
    assert.deepEqual(await db.activityRecord.findMany({ orderBy: { id: 'asc' } }), before)
  })

  test('filters work and findings link to their record', async () => {
    const high = await load(admin, '&severity=high')
    assert.ok(high.body.rows.every((f: { severity: string }) => f.severity === 'high'))
    const ev = await load(admin, '&type=MISSING_EVIDENCE')
    assert.ok(ev.body.rows.some((f: { recordId: string }) => f.recordId === recId))
    assert.equal((await load(admin, '&scope=1')).body.rows.length, 0) // everything here is Scope 2
  })

  test('a reviewer can mark a finding as needing no change, and reopen it; thresholds are configurable', async () => {
    const key = `ANOMALY:${gridId}:2024-03`
    assert.equal((await entry.post('/api/data-quality/reviews', { findingKey: key, note: 'x' })).status, 403)
    assert.equal((await admin.post('/api/data-quality/reviews', { findingKey: key, note: '' })).status, 400)
    assert.equal((await admin.post('/api/data-quality/reviews', { findingKey: key, note: 'New kiln started in March' })).status, 204)
    assert.ok(!(await load(admin)).body.rows.some((f: { key: string }) => f.key === key))
    const reviewed = (await load(admin, '&state=reviewed')).body.rows.find((f: { key: string }) => f.key === key)
    assert.equal(reviewed.review.note, 'New kiln started in March')
    assert.equal((await admin.del(`/api/data-quality/reviews?key=${encodeURIComponent(key)}`)).status, 204)
    assert.ok((await load(admin)).body.rows.some((f: { key: string }) => f.key === key))

    assert.equal((await admin.patch('/api/organizations/current/settings', { qualityAnomalyPercent: 500 })).status, 200)
    assert.ok(!(await load(admin, '&type=ANOMALY')).body.rows.length)
    await admin.patch('/api/organizations/current/settings', { qualityAnomalyPercent: 50 })
  })

  test('data entry can view; verifiers and other organisations cannot', async () => {
    assert.equal((await load(entry)).status, 200)
    assert.equal((await load(verifier)).status, 403)
    assert.equal((await load(foreign)).status, 404)
  })
})
