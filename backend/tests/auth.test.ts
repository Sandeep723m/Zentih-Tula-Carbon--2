import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { SEALED_PREFIX, hashPassword, matchTotp, newTotpSecret, openSecret, sealSecret, totpCode, verifyPassword } from '../src/auth/crypto.js'
import { env } from '../src/config/env.js'
import { can } from '../src/auth/permissions.js'
import { getPrisma } from '../src/config/database.js'
import { client, currentCode, makeOrg, makeUser, signIn, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()

describe('crypto', () => {
  test('TOTP matches RFC 6238 test vector', () => {
    // RFC 6238 secret "12345678901234567890", T=59s → step 1 → 94287082 (last 6 digits)
    assert.equal(totpCode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ', 1), '287082')
  })

  test('TOTP accepts ±1 step drift and rejects others', () => {
    const s = newTotpSecret()
    const now = Date.now()
    const step = Math.floor(now / 30000)
    assert.equal(matchTotp(s, totpCode(s, step - 1), now), step - 1)
    assert.equal(matchTotp(s, totpCode(s, step + 2), now), null)
    assert.equal(matchTotp(s, 'abcdef', now), null)
  })

  test('password hash verifies only the right password', async () => {
    const h = await hashPassword('s3cret-pass')
    assert.equal(await verifyPassword('s3cret-pass', h), true)
    assert.equal(await verifyPassword('wrong', h), false)
  })
})

describe('permissions', () => {
  test('role matrix', () => {
    assert.equal(can('TENANT_ADMIN', 'users.manage'), true)
    assert.equal(can('DATA_ENTRY', 'activity.write'), true)
    assert.equal(can('DATA_ENTRY', 'activity.review'), false)
    assert.equal(can('REVIEWER', 'activity.write'), false)
    assert.equal(can('VERIFIER', 'activity.write'), false)
    assert.equal(can('VERIFIER', 'query.create'), true)
    assert.equal(can('REVIEWER', 'query.create'), false)
  })
})

describe('login', () => {
  test('wrong password and unknown email give the same 401', async () => {
    const u = await makeUser()
    const c = client(base)
    const a = await c.post('/api/auth/login', { email: u.email, password: 'nope' })
    const b = await c.post('/api/auth/login', { email: 'ghost@example.com', password: 'nope' })
    assert.equal(a.status, 401)
    assert.deepEqual(a.body, b.body)
  })

  test('account locks after 5 failures, even for the right password', async () => {
    const u = await makeUser()
    const c = client(base)
    for (let i = 0; i < 5; i++) await c.post('/api/auth/login', { email: u.email, password: 'nope' })
    const r = await c.post('/api/auth/login', { email: u.email, password: 'correct horse battery' })
    assert.equal(r.status, 429)
    const audit = await db.auditLog.findFirst({ where: { entityId: u.id, action: 'auth.locked' } })
    assert.ok(audit)
  })

  test('email is case-insensitive', async () => {
    const u = await makeUser()
    const r = await client(base).post('/api/auth/login', { email: u.email.toUpperCase(), password: 'correct horse battery' })
    assert.equal(r.status, 200)
  })
})

describe('two-step verification', () => {
  test('first sign-in: setup → verify → full access', async () => {
    const u = await makeUser()
    const c = client(base)
    const login = await c.post('/api/auth/login', { email: u.email, password: 'correct horse battery' })
    assert.deepEqual(login.body, { mfa: 'setup' })

    // Before the second factor nothing beyond /me is reachable.
    assert.equal((await c.get('/api/auth/organizations')).status, 401)
    assert.equal((await c.get('/api/auth/me')).body.mfaVerified, false)

    const setup = await c.post('/api/auth/mfa/setup')
    assert.match(setup.body.otpauthUrl, /^otpauth:\/\/totp\//)
    assert.equal((await c.post('/api/auth/mfa/verify', { code: '000000' })).status, 401)
    assert.equal((await c.post('/api/auth/mfa/verify', { code: currentCode(setup.body.secret) })).status, 200)

    assert.equal((await c.get('/api/auth/me')).body.mfaVerified, true)
    assert.equal((await c.get('/api/auth/organizations')).status, 200)
    assert.equal((await db.user.findUniqueOrThrow({ where: { id: u.id } })).mfaEnabled, true)
    // Setup cannot be re-run to swap the secret.
    assert.equal((await c.post('/api/auth/mfa/setup')).status, 409)
  })

  test('authenticator secrets are stored encrypted; older plain ones still work and get encrypted', async () => {
    const s = newTotpSecret()
    const sealed = sealSecret(s)
    assert.ok(sealed.startsWith(SEALED_PREFIX)); assert.ok(!sealed.includes(s)); assert.notEqual(sealSecret(s), sealed) // fresh IV each time
    assert.equal(openSecret(sealed), s)
    assert.equal(openSecret(s), s) // stored before encryption was set up

    const fresh = await makeUser()
    const c = client(base)
    await c.post('/api/auth/login', { email: fresh.email, password: 'correct horse battery' })
    const setup = await c.post('/api/auth/mfa/setup')
    const stored = (await db.user.findUniqueOrThrow({ where: { id: fresh.id } })).mfaSecret!
    assert.ok(stored.startsWith(SEALED_PREFIX)); assert.ok(!stored.includes(setup.body.secret))
    assert.equal((await c.post('/api/auth/mfa/setup')).body.secret, setup.body.secret) // a reload shows the same key
    assert.equal((await c.post('/api/auth/mfa/verify', { code: currentCode(setup.body.secret) })).status, 200)

    const legacy = newTotpSecret()
    const old = await makeUser(undefined, legacy) // plain secret, as on servers before this change
    await signIn(base, old.email, legacy)
    assert.ok((await db.user.findUniqueOrThrow({ where: { id: old.id } })).mfaSecret!.startsWith(SEALED_PREFIX))

    // A changed or missing key fails safely: no sign-in, a clear message, nothing leaked.
    const key = env.MFA_ENCRYPTION_KEY
    env.MFA_ENCRYPTION_KEY = 'a-different-key-of-enough-length-0123456789'
    try {
      const d = client(base)
      await d.post('/api/auth/login', { email: old.email, password: 'correct horse battery' })
      const r = await d.post('/api/auth/mfa/verify', { code: currentCode(legacy, 1) })
      assert.equal(r.status, 503); assert.match(r.body.error, /temporarily unavailable/)
    } finally { env.MFA_ENCRYPTION_KEY = key }
  })

  test('the same code cannot be used twice', async () => {
    const secret = newTotpSecret()
    const u = await makeUser(undefined, secret)
    const code = currentCode(secret)
    const a = client(base)
    await a.post('/api/auth/login', { email: u.email, password: 'correct horse battery' })
    assert.equal((await a.post('/api/auth/mfa/verify', { code })).status, 200)
    const b = client(base)
    await b.post('/api/auth/login', { email: u.email, password: 'correct horse battery' })
    assert.equal((await b.post('/api/auth/mfa/verify', { code })).status, 401)
  })

  test('5 wrong codes end the session', async () => {
    const secret = newTotpSecret()
    const u = await makeUser(undefined, secret)
    const c = client(base)
    await c.post('/api/auth/login', { email: u.email, password: 'correct horse battery' })
    for (let i = 0; i < 5; i++) await c.post('/api/auth/mfa/verify', { code: '000000' })
    assert.equal((await c.get('/api/auth/me')).status, 401)
  })

  test('logout ends the session', async () => {
    const secret = newTotpSecret()
    const u = await makeUser(undefined, secret)
    const c = await signIn(base, u.email, secret)
    assert.equal((await c.post('/api/auth/logout')).status, 204)
    assert.equal((await c.get('/api/auth/me')).status, 401)
  })
})

describe('organisation access and isolation', () => {
  test('user sees and can select only their own organisations', async () => {
    const secret = newTotpSecret()
    const u = await makeUser(undefined, secret)
    const mine = await makeOrg('Mine Ltd', [[u.id, 'DATA_ENTRY']])
    const other = await makeOrg('Other Ltd')
    const c = await signIn(base, u.email, secret)

    const list = await c.get('/api/auth/organizations')
    assert.deepEqual(list.body.map((o: { id: string }) => o.id), [mine.id])

    // No org chosen yet → org-scoped routes refuse.
    assert.equal((await c.get('/api/organizations/current')).status, 403)
    assert.equal((await c.post('/api/auth/organization', { organizationId: other.id })).status, 403)

    const sel = await c.post('/api/auth/organization', { organizationId: mine.id })
    assert.equal(sel.body.role, 'DATA_ENTRY')
    assert.ok(sel.body.permissions.includes('activity.write'))
    assert.ok(!sel.body.permissions.includes('users.manage'))
    assert.equal((await c.get('/api/organizations/current')).body.id, mine.id)
  })

  test('removing a membership revokes access on the next request', async () => {
    const secret = newTotpSecret()
    const u = await makeUser(undefined, secret)
    const org = await makeOrg('Revoked Ltd', [[u.id, 'REVIEWER']])
    const c = await signIn(base, u.email, secret)
    await c.post('/api/auth/organization', { organizationId: org.id })
    assert.equal((await c.get('/api/organizations/current')).status, 200)
    await db.membership.deleteMany({ where: { userId: u.id } })
    assert.equal((await c.get('/api/organizations/current')).status, 403)
  })
})

describe('audit log', () => {
  test('entries cannot be edited or deleted', async () => {
    const entry = await db.auditLog.create({ data: { action: 'test', entityType: 'Test' } })
    await assert.rejects(db.auditLog.update({ where: { id: entry.id }, data: { action: 'tampered' } }))
    await assert.rejects(db.auditLog.delete({ where: { id: entry.id } }))
  })
})
