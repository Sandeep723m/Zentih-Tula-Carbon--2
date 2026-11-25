import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { hashPassword } from '../src/auth/crypto.js'
import { getPrisma } from '../src/config/database.js'
import { effectiveStatus, orgAccess } from '../src/services/access.js'
import { client, currentCode, makeOrg, signInAs, signInSuperAdmin, startServer } from './helpers.js'
import { newTotpSecret } from '../src/auth/crypto.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()

type Client = Awaited<ReturnType<typeof signInAs>>
let sa: Client

const newOrg = (name: string, extra: Record<string, unknown> = {}) => ({
  name,
  country: 'India',
  admin: { email: `admin.${name.replace(/\W/g, '').toLowerCase()}@example.com`, name: `${name} Admin` },
  subscription: { planName: 'Pilot', status: 'ACTIVE', startDate: '2026-01-01', endDate: '' },
  ...extra,
})

before(async () => { sa = await signInSuperAdmin(base) })

describe('access rules', () => {
  const now = new Date('2026-06-15T10:00:00Z')
  const d = (s: string) => new Date(s)

  test('end date is inclusive; past it, Trial/Active count as Expired', () => {
    assert.equal(effectiveStatus({ status: 'ACTIVE', startDate: d('2026-01-01'), endDate: d('2026-06-15') }, now), 'ACTIVE')
    assert.equal(effectiveStatus({ status: 'TRIAL', startDate: d('2026-01-01'), endDate: d('2026-06-14') }, now), 'EXPIRED')
    assert.equal(effectiveStatus({ status: 'CANCELLED', startDate: d('2026-01-01'), endDate: d('2026-06-14') }, now), 'CANCELLED')
  })

  test('status → access', () => {
    const open = { startDate: d('2026-01-01'), endDate: null }
    assert.equal(orgAccess({ status: 'ACTIVE' }, { status: 'ACTIVE', ...open }, now).access, 'full')
    assert.equal(orgAccess({ status: 'ACTIVE' }, { status: 'TRIAL', ...open }, now).access, 'full')
    assert.equal(orgAccess({ status: 'ACTIVE' }, { status: 'EXPIRED', ...open }, now).access, 'read')
    assert.equal(orgAccess({ status: 'ACTIVE' }, { status: 'CANCELLED', ...open }, now).access, 'read')
    assert.equal(orgAccess({ status: 'ACTIVE' }, { status: 'SUSPENDED', ...open }, now).access, 'none')
    assert.equal(orgAccess({ status: 'ACTIVE' }, { status: 'ACTIVE', startDate: d('2026-07-01'), endDate: null }, now).access, 'read')
    assert.equal(orgAccess({ status: 'SUSPENDED' }, { status: 'ACTIVE', ...open }, now).access, 'none')
    assert.equal(orgAccess({ status: 'ACTIVE' }, null, now).access, 'read')
  })
})

describe('super admin authentication', () => {
  test('bootstrap-style account must change its password before anything else', async () => {
    const secret = newTotpSecret()
    const email = 'boot.admin@example.com'
    await db.user.create({ data: { email, name: 'Boot', passwordHash: await hashPassword('admin@123'), platformRole: 'SUPER_ADMIN', mustChangePassword: true, mfaSecret: secret, mfaEnabled: true } })
    const c = client(base)
    assert.equal((await c.post('/api/auth/login', { email, password: 'admin@123' })).status, 200)
    assert.equal((await c.post('/api/auth/mfa/verify', { code: currentCode(secret) })).status, 200)
    const me = await c.get('/api/auth/me')
    assert.equal(me.body.user.mustChangePassword, true)
    assert.equal(me.body.user.platformRole, 'SUPER_ADMIN')
    assert.equal((await c.get('/api/platform/summary')).status, 403) // blocked until changed
    assert.equal((await c.post('/api/auth/password', { newPassword: 'short' })).status, 400)
    assert.equal((await c.post('/api/auth/password', { newPassword: 'a-much-better-pass' })).status, 200) // forced: no current password
    assert.equal((await c.get('/api/platform/summary')).status, 200)
    // Later changes (Account Settings) need the current password again.
    assert.equal((await c.post('/api/auth/password', { newPassword: 'another-good-pass' })).status, 400)
    assert.equal((await c.post('/api/auth/password', { currentPassword: 'wrong', newPassword: 'another-good-pass' })).status, 400)
    assert.equal((await c.post('/api/auth/password', { currentPassword: 'a-much-better-pass', newPassword: 'a-much-better-pass' })).status, 400) // same as current
    assert.equal((await c.post('/api/auth/password', { currentPassword: 'a-much-better-pass', newPassword: 'another-good-pass' })).status, 200)
    assert.ok(await db.auditLog.findFirst({ where: { action: 'auth.password_changed', actorUserId: me.body.user.id } }))
  })

  test('ordinary users, including Tenant Admins, are refused every platform API', async () => {
    const org = await makeOrg('Ordinary Org')
    const tenantAdmin = await signInAs(base, org.id, 'TENANT_ADMIN')
    for (const [method, path] of [
      ['get', '/api/platform/summary'], ['get', '/api/platform/organizations'], ['post', '/api/platform/organizations'],
      ['get', `/api/platform/organizations/${org.id}`], ['get', '/api/platform/users'], ['get', '/api/platform/audit'],
    ] as const) {
      const r = method === 'get' ? await tenantAdmin.get(path) : await tenantAdmin.post(path, newOrg('X'))
      assert.equal(r.status, 403, path)
    }
    assert.equal((await client(base).get('/api/platform/summary')).status, 401)
  })

  test('an organisation user cannot make themselves Super Admin', async () => {
    const org = await makeOrg('Escalation Org')
    const admin = await signInAs(base, org.id, 'TENANT_ADMIN')
    const members = (await admin.get('/api/members')).body
    assert.equal((await admin.patch(`/api/members/${members[0].id}`, { role: 'SUPER_ADMIN' })).status, 400) // not a tenant role
    assert.equal((await admin.patch(`/api/platform/users/${admin.user.id}`, { platformRole: 'SUPER_ADMIN' })).status, 403)
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: admin.user.id } })).platformRole, null)
  })
})

describe('production readiness', () => {
  test('Super Admins see each check with a fix; nobody else can, and no secret values are returned', async () => {
    const r = await sa.get('/api/platform/readiness')
    assert.equal(r.status, 200)
    const byKey = Object.fromEntries(r.body.checks.map((c: { key: string; ok: boolean; fix: string }) => [c.key, c]))
    assert.deepEqual(Object.keys(byKey).sort(), ['ai', 'bootstrap', 'mfaKey', 'triggers'])
    assert.equal(byKey.triggers.ok, true) // the test database has the append-only trigger
    assert.ok(Object.values(byKey).every((c) => typeof (c as { fix: string }).fix === 'string'))
    assert.ok(!JSON.stringify(r.body).includes(process.env.MFA_ENCRYPTION_KEY!))
    const org = await makeOrg('Readiness Co')
    const admin = await signInAs(base, org.id, 'TENANT_ADMIN')
    assert.equal((await admin.get('/api/platform/readiness')).status, 403)
  })
})

describe('organisation management', () => {
  let orgId: string
  let tempPassword: string

  test('create organisation + subscription + first Tenant Admin in one step', async () => {
    const r = await sa.post('/api/platform/organizations', newOrg('Acme Cement'))
    assert.equal(r.status, 201, JSON.stringify(r.body))
    orgId = r.body.organization.id
    tempPassword = r.body.temporaryPassword
    assert.ok(tempPassword)
    assert.equal(r.body.admin.role, 'TENANT_ADMIN')
    const sub = await db.subscription.findUniqueOrThrow({ where: { organizationId: orgId } })
    assert.equal(sub.planName, 'Pilot')
    assert.equal(sub.endDate, null)
    assert.equal(await db.subscriptionEvent.count({ where: { organizationId: orgId } }), 1)
    for (const action of ['organization.created', 'subscription.created', 'member.added']) {
      assert.ok(await db.auditLog.findFirst({ where: { organizationId: orgId, action } }), action)
    }
    const admin = await db.user.findUniqueOrThrow({ where: { email: 'admin.acmecement@example.com' } })
    assert.equal(admin.mustChangePassword, true)
  })

  test('creation is all-or-nothing and validated', async () => {
    const before = await db.organization.count()
    assert.equal((await sa.post('/api/platform/organizations', newOrg('Bad', { subscription: { planName: 'P', status: 'ACTIVE', startDate: '2026-05-01', endDate: '2026-01-01' } }))).status, 400)
    assert.equal((await sa.post('/api/platform/organizations', newOrg('', {}))).status, 400)
    // Admin email already in this org cannot happen on create, but a Super Admin email can't join an org:
    assert.equal((await sa.post('/api/platform/organizations', newOrg('Clash', { admin: { email: sa.user.email, name: 'x' } }))).status, 409)
    assert.equal(await db.organization.count(), before)
  })

  test('list, search and filter', async () => {
    await sa.post('/api/platform/organizations', newOrg('Beta Steel', { subscription: { planName: 'Pilot', status: 'TRIAL', startDate: '2025-01-01', endDate: '2025-12-31' } }))
    const all = await sa.get('/api/platform/organizations')
    assert.equal(all.body.total, await db.organization.count())
    const search = await sa.get('/api/platform/organizations?q=cement')
    assert.deepEqual(search.body.rows.map((o: { name: string }) => o.name), ['Acme Cement'])
    // Database filter agrees with the date-aware status (Beta Steel's trial ended in 2025).
    const expired = await sa.get('/api/platform/organizations?subscription=EXPIRED')
    assert.ok(expired.body.rows.some((o: { name: string }) => o.name === 'Beta Steel'))
    assert.ok(expired.body.rows.every((o: { subscription: { effectiveStatus: string } }) => o.subscription.effectiveStatus === 'EXPIRED'))
    const trial = await sa.get('/api/platform/organizations?subscription=TRIAL')
    assert.ok(trial.body.rows.every((o: { subscription: { effectiveStatus: string } }) => o.subscription.effectiveStatus === 'TRIAL'))
    assert.ok(!trial.body.rows.some((o: { name: string }) => o.name === 'Beta Steel'))
  })

  test('detail shows structure, members, subscription history and audit', async () => {
    const r = await sa.get(`/api/platform/organizations/${orgId}`)
    assert.equal(r.status, 200)
    assert.equal(r.body.memberships.length, 1)
    assert.equal(r.body.subscription.effectiveStatus, 'ACTIVE')
    assert.equal(r.body.access, 'full')
    assert.ok(Array.isArray(r.body.facilities) && Array.isArray(r.body.reportingPeriods))
    assert.ok(r.body.audit.some((a: { action: string; actor: { email: string } | null }) => a.action === 'organization.created' && a.actor?.email === sa.user.email))
    assert.equal((await sa.get('/api/platform/organizations/00000000-0000-0000-0000-000000000000')).status, 404)
  })

  test('edit profile', async () => {
    const r = await sa.patch(`/api/platform/organizations/${orgId}`, { legalName: 'Acme Cement Pvt Ltd' })
    assert.equal(r.status, 200)
    assert.equal(r.body.legalName, 'Acme Cement Pvt Ltd')
  })

  test('add members with any role; change roles afterwards', async () => {
    const invite = await sa.post(`/api/platform/organizations/${orgId}/members`, { email: 'second.admin@acme.example', name: 'Second Admin', role: 'TENANT_ADMIN' })
    assert.equal(invite.status, 201)
    assert.ok(invite.body.temporaryPassword)
    const entry = await sa.post(`/api/platform/organizations/${orgId}/members`, { email: 'entry@acme.example', name: 'Entry', role: 'DATA_ENTRY' })
    assert.equal(entry.body.member.role, 'DATA_ENTRY')
    assert.equal((await sa.post(`/api/platform/organizations/${orgId}/members`, { email: 'entry@acme.example', name: 'Again', role: 'VERIFIER' })).status, 409)
    assert.equal((await sa.post(`/api/platform/organizations/${orgId}/members`, { email: 'x@acme.example', name: 'X', role: 'SUPER_ADMIN' })).status, 400)
    const promote = await sa.patch(`/api/platform/organizations/${orgId}/members/${entry.body.member.id}`, { role: 'TENANT_ADMIN' })
    assert.equal(promote.body.role, 'TENANT_ADMIN')
    // Role change through the platform still protects the last admin.
    const solo = (await sa.post('/api/platform/organizations', newOrg('Solo Co'))).body
    assert.equal((await sa.patch(`/api/platform/organizations/${solo.organization.id}/members/${solo.admin.id}`, { role: 'REVIEWER' })).status, 409)
  })
})

describe('suspension and subscription restrictions', () => {
  let org: { id: string }
  let admin: Client, entry: Client

  before(async () => {
    org = await makeOrg('Restricted Org')
    admin = await signInAs(base, org.id, 'TENANT_ADMIN')
    entry = await signInAs(base, org.id, 'DATA_ENTRY')
    await admin.post('/api/facilities', { name: 'Site', code: 'S1' })
  })

  const setSub = (status: string, endDate: string | null = null, startDate = '2020-01-01') =>
    sa.put(`/api/platform/organizations/${org.id}/subscription`, { planName: 'Standard', status, startDate, endDate, reason: 'test' })

  test('subscription changes are recorded as history and audited', async () => {
    const r = await setSub('ACTIVE')
    assert.equal(r.status, 200)
    assert.equal(r.body.effectiveStatus, 'ACTIVE')
    assert.equal(await db.subscriptionEvent.count({ where: { organizationId: org.id } }), 1)
    assert.ok(await db.auditLog.findFirst({ where: { organizationId: org.id, action: 'subscription.changed' } }))
  })

  test('expired subscription: read-only for existing sessions, nothing deleted', async () => {
    const facilitiesBefore = await db.facility.count({ where: { organizationId: org.id } })
    await setSub('ACTIVE', '2021-01-01') // ended in the past
    assert.equal((await admin.get('/api/facilities')).status, 200)
    const write = await admin.post('/api/facilities', { name: 'New', code: 'N1' })
    assert.equal(write.status, 403)
    assert.match(write.body.error, /expired/)
    const me = await entry.get('/api/auth/me')
    assert.equal(me.body.access, 'read')
    assert.equal(await db.facility.count({ where: { organizationId: org.id } }), facilitiesBefore)
  })

  test('cancelled is read-only; suspended subscription blocks access', async () => {
    await setSub('CANCELLED')
    assert.equal((await admin.post('/api/facilities', { name: 'New', code: 'N2' })).status, 403)
    assert.equal((await admin.get('/api/facilities')).status, 200)
    await setSub('SUSPENDED')
    assert.equal((await admin.get('/api/facilities')).status, 403)
  })

  test('suspending the organisation blocks members immediately and keeps data; reactivating restores', async () => {
    await setSub('ACTIVE')
    assert.equal((await sa.post(`/api/platform/organizations/${org.id}/status`, { status: 'SUSPENDED' })).status, 400) // reason required
    const r = await sa.post(`/api/platform/organizations/${org.id}/status`, { status: 'SUSPENDED', reason: 'Non-payment' })
    assert.equal(r.status, 200)
    assert.equal((await entry.get('/api/activities')).status, 403)
    assert.equal((await admin.get('/api/facilities')).status, 403)
    const picker = await admin.get('/api/auth/organizations')
    assert.equal(picker.body.find((o: { id: string }) => o.id === org.id).access, 'none')
    assert.equal((await admin.post('/api/auth/organization', { organizationId: org.id })).status, 403)
    assert.equal(await db.facility.count({ where: { organizationId: org.id } }), 1)
    assert.ok(await db.auditLog.findFirst({ where: { organizationId: org.id, action: 'organization.suspended', reason: 'Non-payment' } }))

    assert.equal((await sa.post(`/api/platform/organizations/${org.id}/status`, { status: 'ACTIVE' })).status, 200)
    assert.equal((await admin.post('/api/facilities', { name: 'Back', code: 'B1' })).status, 201)
  })

  test('other organisations are unaffected', async () => {
    const other = await makeOrg('Unaffected Org')
    const otherAdmin = await signInAs(base, other.id, 'TENANT_ADMIN')
    await sa.post(`/api/platform/organizations/${org.id}/status`, { status: 'SUSPENDED', reason: 'x' })
    assert.equal((await otherAdmin.post('/api/facilities', { name: 'Fine', code: 'F1' })).status, 201)
    assert.ok((await otherAdmin.get('/api/facilities')).body.every((f: { code: string }) => f.code === 'F1'))
  })
})

describe('platform users', () => {
  test('create another Super Admin; deactivation ends their sessions', async () => {
    const r = await sa.post('/api/platform/users', { email: 'ops@tulacarbon.example', name: 'Ops' })
    assert.equal(r.status, 201)
    assert.ok(r.body.temporaryPassword)
    const other = await signInSuperAdmin(base)
    assert.equal((await other.get('/api/platform/summary')).status, 200)
    assert.equal((await sa.patch(`/api/platform/users/${other.user.id}`, { isActive: false })).status, 200)
    assert.equal((await other.get('/api/platform/summary')).status, 401)
    assert.equal(await db.session.count({ where: { userId: other.user.id } }), 0)
  })

  test('cannot demote yourself; organisation members cannot be made Super Admin', async () => {
    assert.equal((await sa.patch(`/api/platform/users/${sa.user.id}`, { platformRole: null })).status, 409)
    const org = await makeOrg('Member Org')
    const m = await signInAs(base, org.id, 'REVIEWER')
    assert.equal((await sa.patch(`/api/platform/users/${m.user.id}`, { platformRole: 'SUPER_ADMIN' })).status, 409)
  })

  test('summary and audit come from the database', async () => {
    const s = await sa.get('/api/platform/summary')
    assert.equal(s.body.organizations.total, await db.organization.count())
    assert.equal(s.body.organizations.suspended, await db.organization.count({ where: { status: 'SUSPENDED' } }))
    assert.equal(s.body.users.total, await db.user.count())
    assert.equal(s.body.subscriptions.active + s.body.subscriptions.inactive, await db.subscription.count())
    const audit = await sa.get('/api/platform/audit?platformOnly=true')
    assert.ok(audit.body.rows.some((a: { action: string }) => a.action === 'platform.admin_created'))
    assert.ok(audit.body.rows.every((a: { organizationId: string | null }) => a.organizationId === null))
  })
})

describe('scaling the lists', () => {
  test('organisations and users are paged 50 at a time', async () => {
    await db.organization.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ name: `Bulk ${String(i).padStart(2, '0')}` })) })
    const p1 = await sa.get('/api/platform/organizations?q=Bulk')
    const p2 = await sa.get('/api/platform/organizations?q=Bulk&page=2')
    assert.deepEqual([p1.body.total, p1.body.rows.length, p2.body.rows.length, p1.body.pageSize], [60, 50, 10, 50])
    assert.equal(p2.body.rows[0].name, 'Bulk 50')
    const users = await sa.get('/api/platform/users')
    assert.equal(users.body.total, await db.user.count())
    assert.equal((await sa.get('/api/platform/organizations?page=0')).status, 400)
  })

  test('user filters, and the user page shows their organisations and history', async () => {
    const admins = await sa.get('/api/platform/users?type=SUPER_ADMIN')
    assert.ok(admins.body.rows.every((u: { platformRole: string }) => u.platformRole === 'SUPER_ADMIN'))
    const org = await makeOrg('Detail Org')
    const member = await signInAs(base, org.id, 'VERIFIER')
    const row = (await sa.get(`/api/platform/users?q=${encodeURIComponent(member.user.email)}`)).body.rows[0]
    assert.equal(row._count.memberships, 1)
    assert.equal(row.memberships, undefined) // list stays compact
    const detail = await sa.get(`/api/platform/users/${member.user.id}`)
    assert.deepEqual(detail.body.memberships.map((m: { role: string; organization: { name: string } }) => [m.organization.name, m.role]), [['Detail Org', 'VERIFIER']])
    assert.ok(Array.isArray(detail.body.audit))
    assert.equal((await member.get(`/api/platform/users/${member.user.id}`)).status, 403)
  })
})

describe('scaling: audit and activity paging', () => {
  test('audit trail pages newest-first with a cursor, without gaps or repeats', async () => {
    const seen: string[] = []
    let cursor: string | null = null
    do {
      const r = await sa.get(`/api/platform/audit${cursor ? `?before=${cursor}` : ''}`)
      assert.ok(r.body.rows.length <= 50)
      seen.push(...r.body.rows.map((a: { id: string }) => a.id))
      cursor = r.body.nextCursor
    } while (cursor)
    assert.equal(new Set(seen).size, seen.length)
    assert.equal(seen.length, await db.auditLog.count())
  })

  test('activity records page 50 at a time within the organisation', async () => {
    const org = await makeOrg('Paging Org')
    const admin = await signInAs(base, org.id, 'TENANT_ADMIN')
    const f = (await admin.post('/api/facilities', { name: 'F', code: 'F' })).body.id
    const p = (await admin.post('/api/reporting-periods', { name: 'P', startDate: '2025-01-01', endDate: '2025-12-31' })).body.id
    const s = (await admin.post('/api/emission-sources', { facilityId: f, name: 'S', category: 'FUEL_COMBUSTION' })).body.id
    await db.activityRecord.createMany({ data: Array.from({ length: 55 }, () => ({ organizationId: org.id, facilityId: f, reportingPeriodId: p, emissionSourceId: s, startDate: new Date('2025-02-01'), endDate: new Date('2025-02-01'), quantity: '1', unit: 'L', createdById: admin.user.id, updatedById: admin.user.id })) })
    const p1 = await admin.get('/api/activities')
    const p2 = await admin.get('/api/activities?page=2')
    assert.deepEqual([p1.body.total, p1.body.rows.length, p2.body.rows.length], [55, 50, 5])
    const ids = new Set([...p1.body.rows, ...p2.body.rows].map((r: { id: string }) => r.id))
    assert.equal(ids.size, 55)
    const summary = await admin.get('/api/activities/summary')
    assert.equal(summary.body.byFacilityPeriod[0].facility.code, 'F')
  })
})

describe('users by organisation', () => {
  test('lists only that organisation\'s members, each with their role there', async () => {
    const a = await makeOrg('Roles Org A')
    const b = await makeOrg('Roles Org B')
    const entry = await signInAs(base, a.id, 'DATA_ENTRY')
    const verifier = await signInAs(base, a.id, 'VERIFIER')
    await signInAs(base, b.id, 'REVIEWER')
    await db.membership.create({ data: { userId: entry.user.id, organizationId: b.id, role: 'REVIEWER' } }) // same person, other role elsewhere
    const r = await sa.get(`/api/platform/users?organizationId=${a.id}`)
    assert.equal(r.body.total, 2)
    const roles = Object.fromEntries(r.body.rows.map((u: { id: string; membership: { role: string } }) => [u.id, u.membership.role]))
    assert.deepEqual(roles, { [entry.user.id]: 'DATA_ENTRY', [verifier.user.id]: 'VERIFIER' })
    // Inline role change uses the membership id from the row.
    const row = r.body.rows.find((u: { id: string }) => u.id === entry.user.id)
    assert.equal((await sa.patch(`/api/platform/organizations/${a.id}/members/${row.membership.id}`, { role: 'REVIEWER' })).body.role, 'REVIEWER')
    const inB = (await sa.get(`/api/platform/users?organizationId=${b.id}`)).body.rows.find((u: { id: string }) => u.id === entry.user.id)
    assert.equal(inB.membership.role, 'REVIEWER')
  })
})
