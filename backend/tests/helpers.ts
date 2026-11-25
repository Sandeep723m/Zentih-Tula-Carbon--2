import type { AddressInfo } from 'node:net'
import { app } from '../src/app.js'
import { hashPassword, newTotpSecret, totpCode, totpStep } from '../src/auth/crypto.js'
import { getPrisma } from '../src/config/database.js'
import type { Role } from '../generated/prisma/client.js'

export function startServer() {
  const server = app.listen(0)
  return { server, base: () => `http://localhost:${(server.address() as AddressInfo).port}` }
}

// Minimal cookie-keeping client, like a browser for one user.
export function client(base: () => string) {
  let cookie = ''
  const call = async (method: string, path: string, body?: unknown) => {
    const res = await fetch(`${base()}${path}`, {
      method,
      headers: { 'content-type': 'application/json', ...(cookie ? { cookie } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
    const set = res.headers.get('set-cookie')
    if (set) cookie = set.split(';')[0].endsWith('=') ? '' : set.split(';')[0]
    const text = await res.text()
    return { status: res.status, body: text ? JSON.parse(text) : null }
  }
  return {
    get: (p: string) => call('GET', p),
    post: (p: string, b?: unknown) => call('POST', p, b ?? {}),
    patch: (p: string, b: unknown) => call('PATCH', p, b),
    put: (p: string, b: unknown) => call('PUT', p, b),
    del: (p: string) => call('DELETE', p),
    // Raw file upload, as the browser sends it.
    upload: async (p: string, fileName: string, data: Buffer) => {
      const res = await fetch(`${base()}${p}`, {
        method: 'POST',
        headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(fileName), ...(cookie ? { cookie } : {}) },
        body: new Uint8Array(data),
      })
      const text = await res.text()
      return { status: res.status, body: text ? JSON.parse(text) : null }
    },
    raw: (p: string) => fetch(`${base()}${p}`, { headers: cookie ? { cookie } : {} }),
  }
}

let n = 0
export async function makeUser(password = 'correct horse battery', mfaSecret?: string) {
  n += 1
  return getPrisma().user.create({
    data: {
      email: `user${n}-${Date.now()}@example.com`,
      name: `User ${n}`,
      passwordHash: await hashPassword(password),
      ...(mfaSecret ? { mfaSecret, mfaEnabled: true } : {}),
    },
  })
}

export const makeSite = (organizationId: string, code: string, name = `${code} Site`) =>
  getPrisma().site.create({ data: { organizationId, code, name } })

export async function makeOrg(name: string, members: Array<[string, Role]> = []) {
  // Open-ended trial = full access, as for a normal customer.
  const org = await getPrisma().organization.create({ data: { name, subscription: { create: { planName: 'Test', status: 'TRIAL', startDate: new Date('2020-01-01') } } } })
  for (const [userId, role] of members) {
    await getPrisma().membership.create({ data: { userId, organizationId: org.id, role } })
  }
  return org
}

export const currentCode = (secret: string, offset = 0) => totpCode(secret, totpStep() + offset)

// Full sign-in for a user whose MFA is already enabled; returns the client.
export async function signIn(base: () => string, email: string, secret: string, password = 'correct horse battery') {
  const c = client(base)
  await c.post('/api/auth/login', { email, password })
  const r = await c.post('/api/auth/mfa/verify', { code: currentCode(secret) })
  if (r.status !== 200) throw new Error(`sign-in failed: ${JSON.stringify(r.body)}`)
  return c
}

// A signed-in client for a new user holding `role` in `orgId`, with that organisation selected.
export async function signInAs(base: () => string, orgId: string, role: Role) {
  const secret = newTotpSecret()
  const user = await makeUser(undefined, secret)
  await getPrisma().membership.create({ data: { userId: user.id, organizationId: orgId, role } })
  const c = await signIn(base, user.email, secret)
  const r = await c.post('/api/auth/organization', { organizationId: orgId })
  if (r.status !== 200) throw new Error(`org select failed: ${JSON.stringify(r.body)}`)
  return Object.assign(c, { user })
}

// A signed-in platform Super Admin (role set in the database, as the bootstrap does).
export async function signInSuperAdmin(base: () => string) {
  const secret = newTotpSecret()
  const user = await makeUser(undefined, secret)
  await getPrisma().user.update({ where: { id: user.id }, data: { platformRole: 'SUPER_ADMIN' } })
  return Object.assign(await signIn(base, user.email, secret), { user })
}
