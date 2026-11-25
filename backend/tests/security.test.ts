import assert from 'node:assert/strict'
import { after, describe, test } from 'node:test'
import { RateLimiter } from '../src/middleware/security.js'
import { startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())

const post = (path: string, headers: Record<string, string> = {}) =>
  fetch(`${base()}${path}`, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify({ email: 'nobody@example.com', password: 'x' }) })

describe('HTTP security', () => {
  test('security headers on every response; framework not announced; API responses never cached', async () => {
    for (const path of ['/api/health', '/api/nope']) {
      const res = await fetch(`${base()}${path}`)
      assert.equal(res.headers.get('x-content-type-options'), 'nosniff', path)
      assert.equal(res.headers.get('x-frame-options'), 'DENY', path)
      assert.match(res.headers.get('content-security-policy') ?? '', /frame-ancestors 'none'/, path)
      assert.match(res.headers.get('content-security-policy') ?? '', /script-src 'self'/, path)
      assert.equal(res.headers.get('referrer-policy'), 'same-origin', path)
      assert.equal(res.headers.get('cache-control'), 'no-store', path)
      assert.equal(res.headers.get('x-powered-by'), null, path)
    }
  })

  test('state-changing requests from another site are refused (CSRF)', async () => {
    assert.equal((await post('/api/auth/login', { origin: 'https://evil.example' })).status, 403)
    assert.equal((await post('/api/auth/login', { 'sec-fetch-site': 'cross-site' })).status, 403)
    assert.equal((await post('/api/auth/login', { origin: 'http://localhost:5173' })).status, 401) // reaches the login check
    assert.equal((await post('/api/auth/login')).status, 401) // non-browser client: no Origin header
    assert.equal((await fetch(`${base()}/api/health`, { headers: { origin: 'https://evil.example' } })).status, 200) // reads are not blocked
  })

  test('development shortcuts are off outside an explicit development setup', async () => {
    assert.equal((await post('/api/auth/dev/reset-password')).status, 404)
  })
})

describe('rate limiter', () => {
  test('allows the limit within the window, refuses the next, and resets after the window', () => {
    let now = 0
    const limiter = new RateLimiter(3, 1000, () => now)
    assert.deepEqual([1, 2, 3, 4].map(() => limiter.take('1.2.3.4')), [true, true, true, false])
    assert.equal(limiter.take('5.6.7.8'), true) // per key
    now = 1000
    assert.equal(limiter.take('1.2.3.4'), true)
  })
})
