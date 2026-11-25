import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { client, makeOrg, signInAs, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()

type Client = Awaited<ReturnType<typeof signInAs>>
let orgA: { id: string }, orgB: { id: string }
let adminA: Client, adminB: Client, dataEntryA: Client, verifierA: Client

before(async () => {
  orgA = await makeOrg('Org A')
  orgB = await makeOrg('Org B')
  adminA = await signInAs(base, orgA.id, 'TENANT_ADMIN')
  adminB = await signInAs(base, orgB.id, 'TENANT_ADMIN')
  dataEntryA = await signInAs(base, orgA.id, 'DATA_ENTRY')
  verifierA = await signInAs(base, orgA.id, 'VERIFIER')
})

describe('organisation profile and settings', () => {
  test('admin updates profile; blank optional text becomes null; change is audited', async () => {
    const r = await adminA.patch('/api/organizations/current', { name: 'Org A Ltd', legalName: 'Org A Private Limited', country: '' })
    assert.equal(r.status, 200)
    assert.equal(r.body.name, 'Org A Ltd')
    assert.equal(r.body.country, null)
    const audit = await db.auditLog.findFirst({ where: { organizationId: orgA.id, action: 'organization.profile_updated' } })
    assert.ok(audit)
  })

  test('partial update leaves other fields alone', async () => {
    const r = await adminA.patch('/api/organizations/current', { industry: 'Cement' })
    assert.equal(r.body.legalName, 'Org A Private Limited')
  })

  test('settings are validated', async () => {
    assert.equal((await adminA.patch('/api/organizations/current/settings', { timezone: 'Asia/Kolkata', fiscalYearStartMonth: 4 })).status, 200)
    assert.equal((await adminA.patch('/api/organizations/current/settings', { fiscalYearStartMonth: 13 })).status, 400)
    assert.equal((await adminA.patch('/api/organizations/current/settings', { timezone: 'Mars/Base' })).status, 400)
  })

  test('only admins may change the organisation; settings fields are not accepted on the profile route', async () => {
    assert.equal((await dataEntryA.patch('/api/organizations/current', { name: 'Hacked' })).status, 403)
    assert.equal((await verifierA.patch('/api/organizations/current/settings', { fiscalYearStartMonth: 1 })).status, 403)
    const r = await adminA.patch('/api/organizations/current', { fiscalYearStartMonth: 1 })
    assert.equal(r.body.fiscalYearStartMonth, 4) // unknown key stripped by the schema
  })
})

describe('facilities', () => {
  let facilityA: string

  test('admin creates a facility; codes are unique per organisation', async () => {
    const r = await adminA.post('/api/facilities', { name: 'Pune Plant', code: 'PUN-1', city: 'Pune' })
    assert.equal(r.status, 201)
    facilityA = r.body.id
    assert.equal((await adminA.post('/api/facilities', { name: 'Other', code: 'PUN-1' })).status, 409)
    assert.equal((await adminB.post('/api/facilities', { name: 'B Pune', code: 'PUN-1' })).status, 201) // other org: fine
  })

  test('every role can read; only admins can write', async () => {
    assert.equal((await verifierA.get('/api/facilities')).status, 200)
    assert.equal((await dataEntryA.post('/api/facilities', { name: 'X', code: 'X' })).status, 403)
    assert.equal((await verifierA.patch(`/api/facilities/${facilityA}`, { name: 'X' })).status, 403)
  })

  test('another organisation cannot see or change it', async () => {
    const list = await adminB.get('/api/facilities')
    assert.ok(list.body.every((f: { id: string }) => f.id !== facilityA))
    assert.equal((await adminB.patch(`/api/facilities/${facilityA}`, { name: 'Stolen' })).status, 404)
  })

  test('deactivate instead of delete', async () => {
    const r = await adminA.patch(`/api/facilities/${facilityA}`, { isActive: false })
    assert.equal(r.body.isActive, false)
    assert.equal(r.body.name, 'Pune Plant')
  })
})

describe('reporting periods', () => {
  let fy: string

  test('create, and reject overlapping or reversed dates', async () => {
    const r = await adminA.post('/api/reporting-periods', { name: 'FY 2025-26', startDate: '2025-04-01', endDate: '2026-03-31' })
    assert.equal(r.status, 201)
    assert.equal(r.body.status, 'OPEN')
    fy = r.body.id
    const overlap = await adminA.post('/api/reporting-periods', { name: 'Q4', startDate: '2026-01-01', endDate: '2026-06-30' })
    assert.equal(overlap.status, 409)
    assert.match(overlap.body.error, /FY 2025-26/)
    assert.equal((await adminA.post('/api/reporting-periods', { name: 'Bad', startDate: '2027-02-01', endDate: '2027-01-01' })).status, 400)
    // Adjacent is fine; same dates in another org are fine.
    assert.equal((await adminA.post('/api/reporting-periods', { name: 'FY 2026-27', startDate: '2026-04-01', endDate: '2027-03-31' })).status, 201)
    assert.equal((await adminB.post('/api/reporting-periods', { name: 'FY 2025-26', startDate: '2025-04-01', endDate: '2026-03-31' })).status, 201)
  })

  test('editing re-checks dates against the stored values', async () => {
    assert.equal((await adminA.patch(`/api/reporting-periods/${fy}`, { endDate: '2026-04-15' })).status, 409) // runs into FY 2026-27
    assert.equal((await adminA.patch(`/api/reporting-periods/${fy}`, { endDate: '2025-01-01' })).status, 400) // before start
  })

  test('a locked period cannot be edited', async () => {
    await db.reportingPeriod.update({ where: { id: fy }, data: { status: 'LOCKED' } })
    assert.equal((await adminA.patch(`/api/reporting-periods/${fy}`, { name: 'Renamed' })).status, 409)
  })

  test('data entry cannot create periods', async () => {
    assert.equal((await dataEntryA.post('/api/reporting-periods', { name: 'X', startDate: '2030-01-01', endDate: '2030-12-31' })).status, 403)
  })
})

describe('emission sources', () => {
  let facA: string, facB: string

  before(async () => {
    facA = (await adminA.post('/api/facilities', { name: 'Chennai', code: 'CHN' })).body.id
    facB = (await adminB.post('/api/facilities', { name: 'B Site', code: 'BS' })).body.id
  })

  test('scope follows the category', async () => {
    const r = await adminA.post('/api/emission-sources', { facilityId: facA, name: 'DG set 1', category: 'FUEL_COMBUSTION', material: 'Diesel', defaultUnit: 'L' })
    assert.equal(r.status, 201)
    assert.equal(r.body.scope, 1)
    assert.equal(r.body.facility.code, 'CHN')
    const e = await adminA.post('/api/emission-sources', { facilityId: facA, name: 'Grid supply', category: 'PURCHASED_ELECTRICITY', defaultUnit: 'kWh' })
    assert.equal(e.body.scope, 2)
  })

  test('cannot attach a source to another organisation\'s facility', async () => {
    assert.equal((await adminA.post('/api/emission-sources', { facilityId: facB, name: 'Sneaky', category: 'FUGITIVE_GAS' })).status, 400)
    const src = (await adminA.get('/api/emission-sources')).body[0].id
    assert.equal((await adminA.patch(`/api/emission-sources/${src}`, { facilityId: facB })).status, 400)
    assert.equal((await adminB.patch(`/api/emission-sources/${src}`, { name: 'Stolen' })).status, 404)
  })

  test('unknown category is rejected; list filters by facility', async () => {
    assert.equal((await adminA.post('/api/emission-sources', { facilityId: facA, name: 'X', category: 'SCOPE_3_TRAVEL' })).status, 400)
    const r = await verifierA.get(`/api/emission-sources?facilityId=${facA}`)
    assert.equal(r.status, 200)
    assert.equal(r.body.length, 2)
  })
})

describe('users and roles', () => {
  test('inviting a new person returns a one-time password that signs in', async () => {
    const r = await adminA.post('/api/members', { email: 'New.Person@Example.com', name: 'New Person', role: 'DATA_ENTRY' })
    assert.equal(r.status, 201)
    assert.equal(r.body.member.user.email, 'new.person@example.com')
    assert.ok(r.body.temporaryPassword)
    const login = await client(base).post('/api/auth/login', { email: 'new.person@example.com', password: r.body.temporaryPassword })
    assert.equal(login.status, 200)
    assert.equal(login.body.mfa, 'setup')
    assert.equal((await adminA.post('/api/members', { email: 'new.person@example.com', name: 'Again', role: 'VERIFIER' })).status, 409)
  })

  test('inviting an existing account adds a membership without a new password', async () => {
    const r = await adminB.post('/api/members', { email: 'new.person@example.com', name: 'ignored', role: 'VERIFIER' })
    assert.equal(r.status, 201)
    assert.equal(r.body.temporaryPassword, null)
  })

  test('the last Tenant Admin cannot be demoted or removed', async () => {
    const solo = await makeOrg('Solo Org')
    const admin = await signInAs(base, solo.id, 'TENANT_ADMIN')
    const [me] = (await admin.get('/api/members')).body
    assert.equal((await admin.patch(`/api/members/${me.id}`, { role: 'REVIEWER' })).status, 409)
    assert.equal((await admin.del(`/api/members/${me.id}`)).status, 409)
    // With a second admin, demotion works.
    await admin.post('/api/members', { email: 'second.admin@example.com', name: 'Second', role: 'TENANT_ADMIN' })
    assert.equal((await admin.patch(`/api/members/${me.id}`, { role: 'REVIEWER' })).status, 200)
  })

  test('a removed member loses access immediately; other orgs cannot touch members', async () => {
    const members = (await adminA.get('/api/members')).body as Array<{ id: string; user: { id: string } }>
    const target = members.find((m) => m.user.id === dataEntryA.user.id)!
    assert.equal((await adminB.del(`/api/members/${target.id}`)).status, 404)
    assert.equal((await dataEntryA.get('/api/members')).status, 403) // not an admin
    assert.equal((await adminA.del(`/api/members/${target.id}`)).status, 204)
    assert.equal((await dataEntryA.get('/api/facilities')).status, 403) // no organisation any more
    assert.ok(await db.auditLog.findFirst({ where: { organizationId: orgA.id, action: 'member.removed', entityId: target.id } }))
  })
})
