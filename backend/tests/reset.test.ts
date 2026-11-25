import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { client, makeOrg, signInAs, signInSuperAdmin, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()

describe('lost one-time password', () => {
  test('Tenant Admin re-issues a password for a member who has not signed in yet', async () => {
    const org = await makeOrg('Reset Org')
    const admin = await signInAs(base, org.id, 'TENANT_ADMIN')
    const inv = await admin.post('/api/members', { email: 'itachi@reset.test', name: 'Itachi', role: 'VERIFIER' })
    const first = inv.body.temporaryPassword
    const r = await admin.post(`/api/members/${inv.body.member.id}/reset-password`)
    assert.equal(r.status, 200)
    assert.notEqual(r.body.temporaryPassword, first)
    assert.equal((await client(base).post('/api/auth/login', { email: 'itachi@reset.test', password: first })).status, 401) // old one dead
    assert.equal((await client(base).post('/api/auth/login', { email: 'itachi@reset.test', password: r.body.temporaryPassword })).status, 200)
    assert.ok(await db.auditLog.findFirst({ where: { organizationId: org.id, action: 'user.password_reset' } }))
  })

  test('Tenant Admin cannot reset someone who has signed in, or another org\'s member', async () => {
    const org = await makeOrg('Reset Org 2')
    const admin = await signInAs(base, org.id, 'TENANT_ADMIN')
    const active = await signInAs(base, org.id, 'DATA_ENTRY') // mustChangePassword false = has signed in
    const members = (await admin.get('/api/members')).body as Array<{ id: string; user: { id: string } }>
    const m = members.find((x) => x.user.id === active.user.id)!
    assert.equal((await admin.post(`/api/members/${m.id}/reset-password`)).status, 409)
    const other = await signInAs(base, (await makeOrg('Elsewhere')).id, 'TENANT_ADMIN')
    assert.equal((await other.post(`/api/members/${m.id}/reset-password`)).status, 404)
    assert.equal((await active.post(`/api/members/${m.id}/reset-password`)).status, 403) // not an admin
  })

  test('Super Admin resets any password, optionally two-step too; user is signed out', async () => {
    const sa = await signInSuperAdmin(base)
    const org = await makeOrg('SA Reset Org')
    const user = await signInAs(base, org.id, 'REVIEWER')
    const r = await sa.post(`/api/platform/users/${user.user.id}/reset-password`, { resetMfa: true })
    assert.equal(r.status, 200)
    assert.equal((await user.get('/api/facilities')).status, 401) // old session ended
    const after = await db.user.findUniqueOrThrow({ where: { id: user.user.id } })
    assert.deepEqual([after.mustChangePassword, after.mfaEnabled, after.mfaSecret], [true, false, null])
    const login = await client(base).post('/api/auth/login', { email: user.user.email, password: r.body.temporaryPassword })
    assert.equal(login.body.mfa, 'setup')
    assert.equal((await sa.post(`/api/platform/users/${sa.user.id}/reset-password`, {})).status, 409) // not yourself
    assert.equal((await user.post(`/api/platform/users/${sa.user.id}/reset-password`, {})).status, 401)
  })
})
