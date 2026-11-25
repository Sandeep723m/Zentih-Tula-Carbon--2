import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { sanitizeFileName } from '../src/controllers/evidence.controller.js'
import { getPrisma } from '../src/config/database.js'
import { makeOrg, signInAs, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()

type Client = Awaited<ReturnType<typeof signInAs>>
let org: { id: string }
let admin: Client, entry: Client, entry2: Client, reviewer: Client, verifier: Client, otherAdmin: Client
let facility: string, otherFacility: string, period: string, lockedPeriod: string, source: string, sourceOtherFacility: string
let foreignFacility: string, foreignPeriod: string, foreignSource: string

const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF')
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0])

const valid = () => ({ facilityId: facility, reportingPeriodId: period, emissionSourceId: source, startDate: '2025-05-01', endDate: '2025-05-31', quantity: '1250.5', unit: 'L' })

before(async () => {
  org = await makeOrg('Activity Org')
  const other = await makeOrg('Foreign Org')
  admin = await signInAs(base, org.id, 'TENANT_ADMIN')
  entry = await signInAs(base, org.id, 'DATA_ENTRY')
  entry2 = await signInAs(base, org.id, 'DATA_ENTRY')
  reviewer = await signInAs(base, org.id, 'REVIEWER')
  verifier = await signInAs(base, org.id, 'VERIFIER')
  otherAdmin = await signInAs(base, other.id, 'TENANT_ADMIN')

  facility = (await admin.post('/api/facilities', { name: 'Plant 1', code: 'P1' })).body.id
  otherFacility = (await admin.post('/api/facilities', { name: 'Plant 2', code: 'P2' })).body.id
  period = (await admin.post('/api/reporting-periods', { name: 'FY25', startDate: '2025-04-01', endDate: '2026-03-31' })).body.id
  lockedPeriod = (await admin.post('/api/reporting-periods', { name: 'FY24', startDate: '2024-04-01', endDate: '2025-03-31' })).body.id
  await db.reportingPeriod.update({ where: { id: lockedPeriod }, data: { status: 'LOCKED' } })
  source = (await admin.post('/api/emission-sources', { facilityId: facility, name: 'DG set', category: 'FUEL_COMBUSTION', material: 'Diesel', defaultUnit: 'L' })).body.id
  sourceOtherFacility = (await admin.post('/api/emission-sources', { facilityId: otherFacility, name: 'Grid', category: 'PURCHASED_ELECTRICITY' })).body.id

  foreignFacility = (await otherAdmin.post('/api/facilities', { name: 'F', code: 'F' })).body.id
  foreignPeriod = (await otherAdmin.post('/api/reporting-periods', { name: 'FY25', startDate: '2025-04-01', endDate: '2026-03-31' })).body.id
  foreignSource = (await otherAdmin.post('/api/emission-sources', { facilityId: foreignFacility, name: 'S', category: 'FUGITIVE_GAS' })).body.id
})
describe('creating activity records', () => {
  test('data entry saves a draft linked to org, facility, period, source and user', async () => {
    const r = await entry.post('/api/activities', valid())
    assert.equal(r.status, 201)
    assert.equal(r.body.status, 'DRAFT')
    assert.equal(r.body.quantity, '1250.5')
    assert.equal(r.body.createdBy.id, entry.user.id)
    const row = await db.activityRecord.findUniqueOrThrow({ where: { id: r.body.id } })
    assert.equal(row.organizationId, org.id)
    assert.ok(await db.auditLog.findFirst({ where: { action: 'activity.created', entityId: r.body.id } }))
  })

  test('input validation', async () => {
    for (const [patch, msg] of [
      [{ quantity: '0' }, /greater than zero/],
      [{ quantity: '-5' }, /number/],
      [{ quantity: '1.1234567' }, /6 decimal/],
      [{ quantity: 'abc' }, /number/],
      [{ unit: '' }, /unit/],
      [{ startDate: '2025-13-01' }, /start date/],
      [{ endDate: '2025-04-30' }, /on or after/],
    ] as const) {
      const r = await entry.post('/api/activities', { ...valid(), ...patch })
      assert.equal(r.status, 400, JSON.stringify(patch))
      assert.match(JSON.stringify(r.body), msg)
    }
  })

  test('relationships are verified on the server', async () => {
    const cases = [
      [{ facilityId: foreignFacility }, 'Facility not found'],
      [{ reportingPeriodId: foreignPeriod }, 'Reporting period not found'],
      [{ emissionSourceId: foreignSource }, 'Emission source not found'],
      [{ emissionSourceId: sourceOtherFacility }, 'does not belong to the selected facility'],
      [{ startDate: '2026-03-01', endDate: '2026-04-15' }, 'within the reporting period'],
    ] as const
    for (const [patch, msg] of cases) {
      const r = await entry.post('/api/activities', { ...valid(), ...patch })
      assert.equal(r.status, 400, JSON.stringify(patch))
      assert.match(r.body.error, new RegExp(msg))
    }
  })

  test('locked periods and inactive sources reject data', async () => {
    const r = await entry.post('/api/activities', { ...valid(), reportingPeriodId: lockedPeriod, startDate: '2024-05-01', endDate: '2024-05-31' })
    assert.equal(r.status, 409)
    const inactive = (await admin.post('/api/emission-sources', { facilityId: facility, name: 'Old boiler', category: 'FUEL_COMBUSTION', isActive: false })).body.id
    assert.equal((await entry.post('/api/activities', { ...valid(), emissionSourceId: inactive })).status, 400)
  })

  test('reviewers and verifiers can read but not write', async () => {
    assert.equal((await reviewer.post('/api/activities', valid())).status, 403)
    assert.equal((await verifier.post('/api/activities', valid())).status, 403)
    assert.equal((await verifier.get('/api/activities')).status, 200)
  })
})

describe('draft editing and submission', () => {
  let draft: string

  before(async () => { draft = (await entry.post('/api/activities', valid())).body.id })

  test('creator can edit their draft; another data entry user cannot; admin can', async () => {
    assert.equal((await entry.patch(`/api/activities/${draft}`, { quantity: 99 })).status, 200)
    assert.equal((await entry2.patch(`/api/activities/${draft}`, { quantity: 1 })).status, 403)
    const r = await admin.patch(`/api/activities/${draft}`, { notes: 'checked' })
    assert.equal(r.status, 200)
    assert.equal(r.body.quantity, '99')
    assert.equal(r.body.updatedBy.id, admin.user.id)
  })

  test('edits are re-validated against stored values', async () => {
    assert.equal((await entry.patch(`/api/activities/${draft}`, { facilityId: otherFacility })).status, 400) // source belongs to P1
    assert.equal((await entry.patch(`/api/activities/${draft}`, { endDate: '2025-04-15' })).status, 400) // before stored start
  })

  test('other organisations cannot read, edit, submit or delete it', async () => {
    assert.equal((await otherAdmin.get(`/api/activities/${draft}`)).status, 404)
    assert.equal((await otherAdmin.patch(`/api/activities/${draft}`, { quantity: 1 })).status, 404)
    assert.equal((await otherAdmin.post(`/api/activities/${draft}/submit`)).status, 404)
    assert.equal((await otherAdmin.del(`/api/activities/${draft}`)).status, 404)
    assert.ok((await otherAdmin.get('/api/activities')).body.rows.every((r: { id: string }) => r.id !== draft))
  })

  test('evidence is required on submit when the organisation says so', async () => {
    await db.organization.update({ where: { id: org.id }, data: { requireEvidenceOnSubmit: true } })
    const r = await entry.post(`/api/activities/${draft}/submit`)
    assert.equal(r.status, 400)
    assert.match(r.body.error, /evidence/)
    assert.ok(await db.auditLog.findFirst({ where: { action: 'activity.submit_blocked', entityId: draft } }))
    assert.equal((await entry.upload(`/api/activities/${draft}/evidence`, 'bill.pdf', PDF)).status, 201)
    const ok = await entry.post(`/api/activities/${draft}/submit`)
    assert.equal(ok.status, 200)
    assert.equal(ok.body.status, 'SUBMITTED')
    assert.ok(ok.body.submittedAt)
    await db.organization.update({ where: { id: org.id }, data: { requireEvidenceOnSubmit: false } })
  })

  test('submitted records are frozen', async () => {
    assert.equal((await entry.patch(`/api/activities/${draft}`, { quantity: 1 })).status, 409)
    assert.equal((await entry.post(`/api/activities/${draft}/submit`)).status, 409)
    assert.equal((await entry.del(`/api/activities/${draft}`)).status, 409)
    assert.equal((await entry.upload(`/api/activities/${draft}/evidence`, 'more.pdf', PDF)).status, 409)
  })

  test('a draft cannot be submitted or edited once its period is locked', async () => {
    const d = (await entry.post('/api/activities', valid())).body.id
    await db.reportingPeriod.update({ where: { id: period }, data: { status: 'LOCKED' } })
    try {
      assert.equal((await entry.post(`/api/activities/${d}/submit`)).status, 409)
      assert.equal((await entry.patch(`/api/activities/${d}`, { quantity: 5 })).status, 409)
    } finally {
      await db.reportingPeriod.update({ where: { id: period }, data: { status: 'OPEN' } })
    }
  })

  test('reviewers cannot submit', async () => {
    const d = (await entry.post('/api/activities', valid())).body.id
    assert.equal((await reviewer.post(`/api/activities/${d}/submit`)).status, 403)
  })
})

describe('evidence', () => {
  let draft: string

  before(async () => { draft = (await entry.post('/api/activities', valid())).body.id })

  test('upload stores the file outside the record and keeps metadata', async () => {
    const r = await entry.upload(`/api/activities/${draft}/evidence`, 'May bill.pdf', PDF)
    assert.equal(r.status, 201)
    assert.equal(r.body.fileName, 'May bill.pdf')
    assert.equal(r.body.mimeType, 'application/pdf')
    assert.equal(r.body.sizeBytes, PDF.length)
    const row = await db.evidence.findUniqueOrThrow({ where: { id: r.body.id } })
    assert.equal(row.uploadedById, entry.user.id)
    assert.match(row.storageKey, new RegExp(`^${org.id}/`))
    const detail = await reviewer.get(`/api/activities/${draft}`)
    assert.equal(detail.body.evidence.length, 1)
    assert.equal((await verifier.get(`/api/activities/${draft}`)).status, 404) // verifiers see approved records of granted periods only
  })

  test('download returns the exact bytes to the same organisation only', async () => {
    const id = (await db.evidence.findFirstOrThrow({ where: { activityRecordId: draft } })).id
    assert.equal((await verifier.raw(`/api/evidence/${id}/download`)).status, 404) // not granted
    const res = await reviewer.raw(`/api/evidence/${id}/download`)
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-disposition')!, /attachment/)
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
    assert.deepEqual(Buffer.from(await res.arrayBuffer()), PDF)
    assert.equal((await otherAdmin.raw(`/api/evidence/${id}/download`)).status, 404)
  })

  test('rejects wrong types, disguised content, empty and oversized files', async () => {
    const url = `/api/activities/${draft}/evidence`
    assert.equal((await entry.upload(url, 'run.exe', PDF)).status, 400)
    assert.equal((await entry.upload(url, 'fake.pdf', Buffer.from('MZ not a pdf'))).status, 400)
    assert.equal((await entry.upload(url, 'photo.png', PDF)).status, 400)
    assert.equal((await entry.upload(url, 'empty.pdf', Buffer.alloc(0))).status, 400)
    assert.equal((await entry.upload(url, 'big.pdf', Buffer.concat([PDF, Buffer.alloc(11 * 1024 * 1024)]))).status, 413)
    assert.equal((await entry.upload(url, 'meter.png', PNG)).status, 201)
    assert.ok(await db.auditLog.findFirst({ where: { action: 'evidence.upload_rejected', entityId: draft } }))
  })

  test('file names are sanitised', () => {
    assert.equal(sanitizeFileName('../../etc/passwd.pdf'), 'passwd.pdf')
    assert.equal(sanitizeFileName('C:\\Users\\a\\bill<1>.pdf'), 'bill_1_.pdf')
    assert.equal(sanitizeFileName('.hidden.pdf'), 'hidden.pdf')
    assert.equal(sanitizeFileName('बिल मई.pdf'), 'बिल मई.pdf')
  })

  test('readers and other organisations cannot upload', async () => {
    assert.equal((await reviewer.upload(`/api/activities/${draft}/evidence`, 'a.pdf', PDF)).status, 403)
    assert.equal((await otherAdmin.upload(`/api/activities/${draft}/evidence`, 'a.pdf', PDF)).status, 404)
  })

  test('deleting evidence or the draft removes the stored files', async () => {
    const files = await db.evidence.findMany({ where: { activityRecordId: draft } })
    assert.equal((await otherAdmin.del(`/api/evidence/${files[0].id}`)).status, 404)
    assert.equal((await entry.del(`/api/evidence/${files[0].id}`)).status, 204)
    assert.equal((await entry.raw(`/api/evidence/${files[0].id}/download`)).status, 404)
    assert.equal((await entry.del(`/api/activities/${draft}`)).status, 204)
    assert.equal(await db.evidence.count({ where: { activityRecordId: draft } }), 0)
    assert.ok(await db.auditLog.findFirst({ where: { action: 'activity.deleted', entityId: draft } }))
  })
})

describe('dashboard summary', () => {
  test('counts come from this organisation only', async () => {
    const r = await entry.get('/api/activities/summary')
    assert.equal(r.status, 200)
    const actual = await db.activityRecord.groupBy({ by: ['status'], where: { organizationId: org.id }, _count: true })
    const n = (s: string) => actual.find((a) => a.status === s)?._count ?? 0
    assert.equal(r.body.draft, n('DRAFT'))
    assert.equal(r.body.submitted, n('SUBMITTED'))
    assert.equal(r.body.total, n('DRAFT') + n('SUBMITTED'))
    const row = r.body.byFacilityPeriod.find((g: { facility: { code: string } }) => g.facility.code === 'P1')
    assert.equal(row.draft + row.submitted, r.body.total)
    assert.ok(r.body.myDrafts.length > 0)
    const foreign = await otherAdmin.get('/api/activities/summary')
    assert.equal(foreign.body.total, 0)
  })
})
