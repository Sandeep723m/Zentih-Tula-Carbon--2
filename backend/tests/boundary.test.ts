import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { makeOrg, signInAs, signInSuperAdmin, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()

type Client = Awaited<ReturnType<typeof signInSuperAdmin>>
let sa: Client

before(async () => { sa = await signInSuperAdmin(base) })

const url = (orgId: string, rest = '') => `/api/platform/organizations/${orgId}/boundary${rest}`
const draft = (facilities: unknown[], extra: Record<string, unknown> = {}) =>
  ({ approach: 'OPERATIONAL', baseYear: 2024, effectiveFrom: '2024-04-01', facilities, ...extra })
const addFacility = (orgId: string, name: string, data: Record<string, unknown> = {}) =>
  db.facility.create({ data: { organizationId: orgId, name, code: name.replace(/\W/g, '').toUpperCase(), country: 'India', ...data } })

describe('boundary access', () => {
  test('only Super Admins reach the boundary API', async () => {
    const org = await makeOrg('Boundary Access Org')
    const tenantAdmin = await signInAs(base, org.id, 'TENANT_ADMIN')
    assert.equal((await tenantAdmin.get(url(org.id))).status, 403)
    assert.equal((await tenantAdmin.put(url(org.id), draft([]))).status, 403)
    assert.equal((await tenantAdmin.post(url(org.id, '/approve'))).status, 403)
    assert.equal((await tenantAdmin.post(url(org.id, '/new-version'), { changeReason: 'x' })).status, 403)
  })

  test('unknown organisation is a 404', async () => {
    const missing = '00000000-0000-4000-8000-000000000000'
    assert.equal((await sa.get(url(missing))).status, 404)
    assert.equal((await sa.put(url(missing), draft([]))).status, 404)
  })

  test('facilities: Tenant Admin may create, Data Entry may not', async () => {
    const org = await makeOrg('Facility Roles Org')
    const admin = await signInAs(base, org.id, 'TENANT_ADMIN')
    const entry = await signInAs(base, org.id, 'DATA_ENTRY')
    assert.equal((await entry.post('/api/facilities', { name: 'Plant', code: 'P1' })).status, 403)
    assert.equal((await admin.post('/api/facilities', { name: 'Plant', code: 'P1' })).status, 201)
    const r = await sa.get(url(org.id))
    assert.equal(r.body.facilities.length, 1) // tenant-created facility shows up in boundary setup
  })
})

describe('adding facilities from boundary setup', () => {
  test('Super Admin adds a facility; it is audited and listed; duplicates and bad input are refused', async () => {
    const org = await makeOrg('SA Facility Org')
    const r = await sa.post(`/api/platform/organizations/${org.id}/facilities`, { name: 'Factory A', code: 'FA', country: 'India' })
    assert.equal(r.status, 201)
    assert.equal(r.body.organizationId, org.id)
    assert.equal(r.body.scope1Active, true)
    assert.ok(await db.auditLog.findFirst({ where: { action: 'facility.created', entityId: r.body.id, actorUserId: sa.user.id } }))
    assert.equal((await sa.get(url(org.id))).body.facilities.length, 1)
    assert.equal((await sa.post(`/api/platform/organizations/${org.id}/facilities`, { name: 'Factory A2', code: 'FA' })).status, 409)
    assert.equal((await sa.post(`/api/platform/organizations/${org.id}/facilities`, { name: '', code: 'X' })).status, 400)
    assert.equal((await sa.post(`/api/platform/organizations/${org.id}/facilities`, { name: 'Y' })).status, 400)
    assert.equal((await sa.post('/api/platform/organizations/00000000-0000-4000-8000-000000000000/facilities', { name: 'Z', code: 'Z' })).status, 404)
  })

  test('Tenant Admins cannot use the platform facility endpoint', async () => {
    const org = await makeOrg('SA Facility Guard Org')
    const tenantAdmin = await signInAs(base, org.id, 'TENANT_ADMIN')
    assert.equal((await tenantAdmin.post(`/api/platform/organizations/${org.id}/facilities`, { name: 'P', code: 'P' })).status, 403)
  })
})

describe('boundary draft', () => {
  test('empty organisation: no boundary, no facilities', async () => {
    const org = await makeOrg('Empty Boundary Org')
    const r = await sa.get(url(org.id))
    assert.equal(r.status, 200)
    assert.equal(r.body.boundary, null)
    assert.deepEqual(r.body.facilities, [])
  })

  test('invalid input is rejected', async () => {
    const org = await makeOrg('Invalid Boundary Org')
    const f = await addFacility(org.id, 'Plant A')
    for (const bad of [
      draft([], { approach: 'NOPE' }),
      draft([], { baseYear: 1999 }),
      draft([], { effectiveFrom: 'not-a-date' }),
      draft([{ facilityId: f.id, equityShare: 101 }]),
      draft([{ facilityId: f.id, equityShare: -1 }]),
      draft([{ facilityId: 'not-a-uuid' }]),
    ]) {
      assert.equal((await sa.put(url(org.id), bad)).status, 400, JSON.stringify(bad))
    }
    assert.equal(await db.orgBoundary.count({ where: { organizationId: org.id } }), 0)
  })

  test('save creates v1 draft, stores facility fields and the base year; re-save updates it', async () => {
    const org = await makeOrg('Save Boundary Org')
    const f = await addFacility(org.id, 'Plant A')
    const r = await sa.put(url(org.id), draft([{ facilityId: f.id, operationalControl: true, gridLocation: 'India - Southern Grid', scope1Active: true, scope2Active: true }]))
    assert.equal(r.status, 200)
    assert.equal(r.body.version, 1)
    assert.equal(r.body.status, 'DRAFT')
    const fac = await db.facility.findUniqueOrThrow({ where: { id: f.id } })
    assert.equal(fac.operationalControl, true)
    assert.equal(fac.gridLocation, 'India - Southern Grid')
    assert.equal((await db.organization.findUniqueOrThrow({ where: { id: org.id } })).baseYear, 2024)

    const again = await sa.put(url(org.id), draft([{ facilityId: f.id, operationalControl: false, scope2Active: false }], { approach: 'FINANCIAL' }))
    assert.equal(again.body.id, r.body.id) // same draft, not a new version
    assert.equal(again.body.approach, 'FINANCIAL')
    assert.equal(await db.orgBoundary.count({ where: { organizationId: org.id } }), 1)
    assert.ok(await db.auditLog.findFirst({ where: { action: 'boundary.saved', entityId: r.body.id } }))
  })

  test('equity share round-trips: what the page loads can be saved back unchanged', async () => {
    const org = await makeOrg('Equity Roundtrip Org')
    const f = await addFacility(org.id, 'JV Plant')
    await sa.put(url(org.id), draft([{ facilityId: f.id, equityShare: 62.5, scope2Active: false }], { approach: 'EQUITY' }))
    const loaded = (await sa.get(url(org.id))).body.facilities[0]
    assert.equal(loaded.equityShare, 62.5)
    const { id: facilityId, gridLocation, equityShare, operationalControl, financialControl, scope1Active, scope2Active } = loaded
    const r = await sa.put(url(org.id), draft([{ facilityId, gridLocation, equityShare, operationalControl, financialControl, scope1Active, scope2Active }], { approach: 'EQUITY' }))
    assert.equal(r.status, 200)
    assert.equal((await sa.post(url(org.id, '/approve'))).status, 200)
  })

  test("a facility of another organisation cannot be changed through this one's boundary", async () => {
    const mine = await makeOrg('Boundary Mine')
    const theirs = await makeOrg('Boundary Theirs')
    const foreign = await addFacility(theirs.id, 'Their Plant', { gridLocation: 'UK - DEFRA' })
    assert.equal((await sa.put(url(mine.id), draft([{ facilityId: foreign.id, gridLocation: 'India - Southern Grid', scope2Active: true }]))).status, 200)
    assert.equal((await db.facility.findUniqueOrThrow({ where: { id: foreign.id } })).gridLocation, 'UK - DEFRA')
  })
})

describe('boundary approval and versions', () => {
  test('no draft → 404; no facilities → 400', async () => {
    const org = await makeOrg('No Draft Org')
    assert.equal((await sa.post(url(org.id, '/approve'))).status, 404)
    await sa.put(url(org.id), draft([]))
    const r = await sa.post(url(org.id, '/approve'))
    assert.equal(r.status, 400)
    assert.match(r.body.error ?? r.body.message, /at least one active facility/i)
  })

  test('each approach requires its own field on every active facility', async () => {
    const cases: Array<[string, Record<string, unknown>, RegExp]> = [
      ['EQUITY', { equityShare: null }, /equity share/],
      ['OPERATIONAL', { operationalControl: null }, /operational control/],
      ['FINANCIAL', { financialControl: null }, /financial control/],
    ]
    for (const [approach, fields, msg] of cases) {
      const org = await makeOrg(`Approach ${approach} Org`)
      const f = await addFacility(org.id, 'Plant A')
      await sa.put(url(org.id), draft([{ facilityId: f.id, ...fields, scope2Active: false }], { approach }))
      const r = await sa.post(url(org.id, '/approve'))
      assert.equal(r.status, 400, approach)
      assert.match(JSON.stringify(r.body), msg)
      assert.match(JSON.stringify(r.body), /Plant A/)
    }
  })

  test('Scope 2 without a grid location, or no scope at all, blocks approval', async () => {
    const org = await makeOrg('Scope Rules Org')
    const a = await addFacility(org.id, 'Grid Missing')
    const b = await addFacility(org.id, 'No Scope')
    await sa.put(url(org.id), draft([
      { facilityId: a.id, operationalControl: true, scope2Active: true, gridLocation: null },
      { facilityId: b.id, operationalControl: true, scope1Active: false, scope2Active: false },
    ]))
    const r = await sa.post(url(org.id, '/approve'))
    assert.equal(r.status, 400)
    assert.match(JSON.stringify(r.body), /Grid Missing: missing grid location/)
    assert.match(JSON.stringify(r.body), /No Scope: no scope selected/)
  })

  test('inactive facilities do not block approval', async () => {
    const org = await makeOrg('Inactive Facility Org')
    const ok = await addFacility(org.id, 'Active Plant')
    await addFacility(org.id, 'Closed Plant', { isActive: false })
    await sa.put(url(org.id), draft([{ facilityId: ok.id, operationalControl: true, scope2Active: false }]))
    assert.equal((await sa.post(url(org.id, '/approve'))).status, 200)
  })

  test('approve locks; edits need a new version with a reason; history lists both', async () => {
    const org = await makeOrg('Lifecycle Org')
    const f = await addFacility(org.id, 'Plant A')
    const body = draft([{ facilityId: f.id, operationalControl: true, gridLocation: 'India - Western Grid' }])
    await sa.put(url(org.id), body)

    const approved = await sa.post(url(org.id, '/approve'))
    assert.equal(approved.status, 200)
    assert.equal(approved.body.status, 'APPROVED')
    assert.equal(approved.body.approvedById, sa.user.id)
    assert.ok(approved.body.approvedAt)

    assert.equal((await sa.put(url(org.id), body)).status, 409) // locked
    assert.equal((await sa.post(url(org.id, '/approve'))).status, 404) // nothing left to approve
    assert.equal((await sa.post(url(org.id, '/new-version'), { changeReason: '' })).status, 400)

    const v2 = await sa.post(url(org.id, '/new-version'), { changeReason: 'Acquired a new site' })
    assert.equal(v2.status, 200)
    assert.equal(v2.body.version, 2)
    assert.equal(v2.body.status, 'DRAFT')
    assert.equal(v2.body.approach, 'OPERATIONAL') // carried over
    assert.equal((await sa.post(url(org.id, '/new-version'), { changeReason: 'again' })).status, 409) // draft already open
    assert.equal((await sa.put(url(org.id), body)).status, 200) // draft is editable again

    const history = await sa.get(url(org.id, '/history'))
    assert.deepEqual(history.body.map((h: { version: number; status: string }) => [h.version, h.status]), [[2, 'DRAFT'], [1, 'APPROVED']])
    assert.equal((await sa.get(url(org.id))).body.boundary.version, 2)
    assert.ok(await db.auditLog.findFirst({ where: { action: 'boundary.approved', entityId: approved.body.id } }))
    assert.ok(await db.auditLog.findFirst({ where: { action: 'boundary.new_version', entityId: v2.body.id } }))
  })

  test('an approved version keeps its own frozen facility values; drafts have none', async () => {
    const org = await makeOrg('Snapshot Org')
    const f = await addFacility(org.id, 'Plant A')
    await addFacility(org.id, 'Closed', { isActive: false })
    await sa.put(url(org.id), draft([{ facilityId: f.id, operationalControl: true, gridLocation: 'India - Western Grid' }]))
    assert.equal((await sa.get(url(org.id))).body.boundary.snapshot, null)
    await sa.post(url(org.id, '/approve'))

    await sa.post(url(org.id, '/new-version'), { changeReason: 'Grid change' })
    await sa.put(url(org.id), draft([{ facilityId: f.id, operationalControl: true, gridLocation: 'India - Southern Grid' }], { baseYear: 2025 }))

    const [v2, v1] = (await sa.get(url(org.id, '/history'))).body
    assert.equal(v2.snapshot, null)
    assert.equal(v1.snapshot.length, 1) // inactive facility not part of the boundary
    assert.deepEqual(
      { id: v1.snapshot[0].id, name: v1.snapshot[0].name, grid: v1.snapshot[0].gridLocation, op: v1.snapshot[0].operationalControl },
      { id: f.id, name: 'Plant A', grid: 'India - Western Grid', op: true },
    )
    assert.equal(v1.baseYear, 2024)
  })

  test('new version before any boundary exists → 404', async () => {
    const org = await makeOrg('No Boundary Yet Org')
    assert.equal((await sa.post(url(org.id, '/new-version'), { changeReason: 'x' })).status, 404)
  })
})
