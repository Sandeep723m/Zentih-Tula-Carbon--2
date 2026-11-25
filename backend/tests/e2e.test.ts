// The whole journey through the API, in the order a person does it in the browser:
// first sign-ins (two-step setup + forced password change), organisation setup,
// each role's work, and platform suspension / expiry.
import assert from 'node:assert/strict'
import { after, test } from 'node:test'
import { hashPassword, totpCode, totpStep } from '../src/auth/crypto.js'
import { getPrisma } from '../src/config/database.js'
import { client, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
const PDF = Buffer.from('%PDF-1.4\n%%EOF')

// First-ever sign-in exactly as the UI does it. Returns the signed-in client.
async function firstSignIn(email: string, password: string, newPassword: string) {
  const c = client(base)
  const login = await c.post('/api/auth/login', { email: ` ${email.toUpperCase()} `, password }) // sloppy typing still works
  assert.equal(login.status, 200, `login ${email}: ${JSON.stringify(login.body)}`)
  assert.equal(login.body.mfa, 'setup')
  // React dev mode calls setup twice; both calls must return the same key.
  const s1 = await c.post('/api/auth/mfa/setup')
  const s2 = await c.post('/api/auth/mfa/setup')
  assert.equal(s1.body.secret, s2.body.secret)
  assert.equal((await c.post('/api/auth/mfa/verify', { code: totpCode(s1.body.secret, totpStep()) })).status, 200)
  const me = await c.get('/api/auth/me')
  assert.equal(me.body.user.mustChangePassword, true)
  assert.equal((await c.get('/api/auth/organizations')).status, 403) // blocked until the change
  // Forced first change: no current password needed (it was just entered); reusing it is refused.
  assert.equal((await c.post('/api/auth/password', { newPassword: password })).status, 400)
  assert.equal((await c.post('/api/auth/password', { newPassword })).status, 200)
  return Object.assign(c, { secret: s1.body.secret as string })
}

test('full platform → tenant → roles journey', async () => {
  // 1. Bootstrap Super Admin (what `npm run platform:bootstrap` creates).
  await db.user.create({ data: { email: 'admin@tulacarbon.test', name: 'Platform Administrator', passwordHash: await hashPassword('admin@123'), platformRole: 'SUPER_ADMIN', mustChangePassword: true } })
  const sa = await firstSignIn('admin@tulacarbon.test', 'admin@123', 'platform-pass-2026')
  assert.equal((await sa.get('/api/auth/me')).body.user.platformRole, 'SUPER_ADMIN')
  assert.equal((await sa.get('/api/facilities')).status, 403) // platform admin is not inside any tenant

  // 2. Super Admin creates the organisation with its first Tenant Admin.
  const created = await sa.post('/api/platform/organizations', {
    name: 'WAA', admin: { email: 'owner@waa.test', name: 'Redd' },
    subscription: { planName: 'Pilot', status: 'ACTIVE', startDate: '2026-01-01', endDate: null },
  })
  assert.equal(created.status, 201, JSON.stringify(created.body))
  const orgId = created.body.organization.id

  // 3. Tenant Admin's first sign-in, then picks the organisation.
  const admin = await firstSignIn('owner@waa.test', created.body.temporaryPassword, 'Tula-Strong-2026!')
  const orgs = await admin.get('/api/auth/organizations')
  assert.deepEqual(orgs.body.map((o: { name: string; access: string }) => [o.name, o.access]), [['WAA', 'full']])
  assert.equal((await admin.post('/api/auth/organization', { organizationId: orgId })).status, 200)
  assert.equal((await admin.get('/api/auth/me')).body.role, 'TENANT_ADMIN')

  // 4. Organisation setup.
  const fac = await admin.post('/api/facilities', { name: 'Pune Plant', code: 'PUN' })
  const per = await admin.post('/api/reporting-periods', { name: 'FY 2026-27', startDate: '2026-04-01', endDate: '2027-03-31' })
  const src = await admin.post('/api/emission-sources', { facilityId: fac.body.id, name: 'DG set', category: 'FUEL_COMBUSTION', material: 'Diesel', defaultUnit: 'L' })
  assert.deepEqual([fac.status, per.status, src.status], [201, 201, 201])
  assert.equal((await admin.patch('/api/organizations/current/settings', { requireEvidenceOnSubmit: true })).status, 200)

  // 5. Invite one user per role; each completes first sign-in.
  const users: Record<string, Awaited<ReturnType<typeof firstSignIn>>> = {}
  for (const role of ['DATA_ENTRY', 'REVIEWER', 'VERIFIER'] as const) {
    const email = `${role.toLowerCase()}@waa.test`
    const inv = await admin.post('/api/members', { email, name: role, role })
    assert.equal(inv.status, 201)
    users[role] = await firstSignIn(email, inv.body.temporaryPassword, `Tula-${role.length}-Strong-2026`)
    assert.equal((await users[role].post('/api/auth/organization', { organizationId: orgId })).status, 200)
  }
  const { DATA_ENTRY: entry, REVIEWER: reviewer, VERIFIER: verifier } = users

  // 6. Data entry: draft → evidence → submit.
  const rec = await entry.post('/api/activities', { facilityId: fac.body.id, reportingPeriodId: per.body.id, emissionSourceId: src.body.id, startDate: '2026-04-01', endDate: '2026-04-30', quantity: '1200', unit: 'L' })
  assert.equal(rec.status, 201)
  assert.equal((await entry.post(`/api/activities/${rec.body.id}/submit`)).status, 400) // evidence required
  const ev = await entry.upload(`/api/activities/${rec.body.id}/evidence`, 'april-bill.pdf', PDF)
  assert.equal(ev.status, 201)
  assert.equal((await entry.post(`/api/activities/${rec.body.id}/submit`)).body.status, 'SUBMITTED')

  // 7. Reviewer sees it and the evidence, approves it; nobody else can change it.
  assert.equal((await reviewer.get('/api/activities/summary')).body.submitted, 1)
  assert.deepEqual(Buffer.from(await (await reviewer.raw(`/api/evidence/${ev.body.id}/download`)).arrayBuffer()), PDF)
  assert.equal((await entry.post(`/api/activities/${rec.body.id}/approve`)).status, 403)
  assert.equal((await reviewer.post(`/api/activities/${rec.body.id}/approve`)).body.status, 'APPROVED')

  // 7b. The verifier sees nothing until granted the period, then only approved records, read-only.
  assert.equal((await verifier.get('/api/activities/summary')).body.total, 0)
  const verifierId = (await admin.get('/api/members')).body.find((m: { role: string }) => m.role === 'VERIFIER').user.id
  assert.equal((await admin.post('/api/verifier-grants', { userId: verifierId, reportingPeriodId: per.body.id })).status, 201)
  assert.equal((await verifier.get('/api/activities/summary')).body.approved, 1)
  assert.deepEqual(Buffer.from(await (await verifier.raw(`/api/evidence/${ev.body.id}/download`)).arrayBuffer()), PDF)
  for (const c of [reviewer, verifier]) {
    assert.equal((await c.post('/api/activities', {})).status, 403)
    assert.equal((await c.get('/api/members')).status, 403)
  }

  // 8. Platform: expiry → read-only for everyone; suspension → blocked; data kept throughout.
  const sub = (status: string, endDate: string | null) =>
    sa.put(`/api/platform/organizations/${orgId}/subscription`, { planName: 'Pilot', status, startDate: '2026-01-01', endDate })
  assert.equal((await sub('ACTIVE', '2026-01-31')).status, 200)
  assert.equal((await entry.get('/api/auth/me')).body.access, 'read')
  assert.equal((await entry.get('/api/activities')).status, 200)
  assert.equal((await admin.post('/api/facilities', { name: 'X', code: 'X' })).status, 403)
  assert.equal((await sub('ACTIVE', null)).status, 200)
  assert.equal((await sa.post(`/api/platform/organizations/${orgId}/status`, { status: 'SUSPENDED', reason: 'Testing' })).status, 200)
  assert.equal((await verifier.get('/api/activities')).status, 403)
  assert.equal((await admin.get('/api/auth/me')).body.access, 'none')
  assert.equal(await db.activityRecord.count({ where: { organizationId: orgId } }), 1)
  assert.equal((await sa.post(`/api/platform/organizations/${orgId}/status`, { status: 'ACTIVE' })).status, 200)
  assert.equal((await entry.get('/api/activities')).body.total, 1)

  // 9. The whole story is in the organisation's audit history.
  const detail = await sa.get(`/api/platform/organizations/${orgId}`)
  const actions = new Set(detail.body.audit.map((a: { action: string }) => a.action))
  for (const a of ['organization.created', 'member.added', 'facility.created', 'activity.created', 'evidence.uploaded', 'activity.submitted', 'activity.submit_blocked', 'subscription.changed', 'organization.suspended', 'organization.activated']) {
    assert.ok(actions.has(a), `missing audit ${a}`)
  }

  // 10. Signing in again later uses the new password and the same authenticator key.
  const again = client(base)
  assert.equal((await again.post('/api/auth/login', { email: 'owner@waa.test', password: 'Tula-Strong-2026!' })).body.mfa, 'verify')
  assert.equal((await again.post('/api/auth/mfa/verify', { code: totpCode(admin.secret, totpStep() + 1) })).status, 200) // next step: not a replay
  assert.equal((await again.get('/api/auth/organizations')).status, 200)
})
