import assert from 'node:assert/strict'
import type { AddressInfo } from 'node:net'
import { after, before, test } from 'node:test'
import { app } from '../src/app.js'

const server = app.listen(0)
let base = ''
before(() => { base = `http://localhost:${(server.address() as AddressInfo).port}` })
after(() => server.close())

test('GET /api/health returns ok', async () => {
  const res = await fetch(`${base}/api/health`)
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.status, 'ok')
})

test('unknown route returns 404 JSON', async () => {
  const res = await fetch(`${base}/api/nope`)
  assert.equal(res.status, 404)
  assert.match((await res.json()).error, /Route not found/)
})

test('CORS: any localhost port in development, never other sites', async () => {
  const origin = async (o: string) => (await fetch(`${base}/api/health`, { headers: { origin: o } })).headers.get('access-control-allow-origin')
  assert.equal(await origin('http://localhost:5174'), 'http://localhost:5174')
  assert.equal(await origin('https://evil.example'), null)
  assert.equal(await origin('http://localhost.evil.example:5173'), null)
})
