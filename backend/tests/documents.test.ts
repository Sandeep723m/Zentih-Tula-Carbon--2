import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { after, before, beforeEach, describe, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { env } from '../src/config/env.js'
import { makeOrg, signInAs, signInSuperAdmin, startServer } from './helpers.js'

const { server, base } = startServer()
const db = getPrisma()
const KEY = 'test-secret-key-never-leaked'
let n = 0
// Unique content per upload: the same file twice is refused as a duplicate.
const pdf = () => Buffer.from(`%PDF-1.4\n${++n} ${Date.now()}\n%%EOF`)

// Stand-in for the provider's HTTP API, used only by this test file.
type Reply = { status: number; body: unknown; delayMs?: number }
let reply: Reply
const seen: Array<{ url: string; key: string | undefined }> = []
let stub: Server
const good = (fields: Record<string, unknown>): Reply => ({ status: 200, body: { candidates: [{ content: { parts: [{ text: JSON.stringify(fields) }] } }], usageMetadata: { promptTokenCount: 1000, candidatesTokenCount: 200 } } })

type Client = Awaited<ReturnType<typeof signInAs>>
let org: { id: string }, entry: Client, reviewer: Client, verifier: Client, foreign: Client, superAdmin: Awaited<ReturnType<typeof signInSuperAdmin>>

async function settled(c: Client, id: string) {
  for (let i = 0; i < 100; i++) {
    const r = await c.get(`/api/documents/${id}`)
    if (['EXTRACTED', 'FAILED'].includes(r.body.status)) return r.body
    await new Promise((f) => setTimeout(f, 20))
  }
  throw new Error('document did not settle')
}
const upload = async (c: Client, name = 'bill.pdf', data = pdf()) => c.upload('/api/documents', name, data)

before(async () => {
  stub = createServer((req, res) => {
    seen.push({ url: req.url ?? '', key: req.headers['x-goog-api-key'] as string | undefined })
    req.resume()
    setTimeout(() => { res.writeHead(reply.status, { 'content-type': 'application/json' }); res.end(JSON.stringify(reply.body)) }, reply.delayMs ?? 0)
  }).listen(0)
  org = await makeOrg('Intake Org')
  entry = await signInAs(base, org.id, 'DATA_ENTRY')
  reviewer = await signInAs(base, org.id, 'REVIEWER')
  verifier = await signInAs(base, org.id, 'VERIFIER')
  foreign = await signInAs(base, (await makeOrg('Other Org')).id, 'DATA_ENTRY')
  superAdmin = await signInSuperAdmin(base)
})
after(() => { server.close(); stub.close() })
beforeEach(() => {
  Object.assign(env, { AI_PROVIDER: 'gemini', AI_MODEL: 'test-model', GEMINI_API_KEY: KEY, GEMINI_BASE_URL: `http://localhost:${(stub.address() as AddressInfo).port}`, AI_TIMEOUT_MS: 2000, AI_DAILY_LIMIT_PER_ORG: 1000, AI_INPUT_COST_PER_MILLION: 1, AI_OUTPUT_COST_PER_MILLION: 2 })
  reply = good({ documentType: 'ELECTRICITY_BILL', confidence: 0.9 })
  seen.length = 0
})

describe('reading a document', () => {
  test('values are validated: bad ones become empty, usage and cost are recorded, the key stays in the header', async () => {
    reply = good({ documentType: 'NOT_A_TYPE', confidence: 7, supplier: ' TNEB ', periodStart: '2023-10-01', periodEnd: '2023-13-45', quantity: '1,350,000', unit: 'kWh', activityDate: '02/09/2024', density: ' 0.84 kg/l ', otherItems: 'null', supplierFactor: 'N/A', injected: 'ignored' })
    const up = await upload(entry)
    assert.equal(up.status, 201)
    const d = await settled(entry, up.body.id)
    assert.equal(d.status, 'EXTRACTED')
    assert.equal(d.documentType, 'OTHER')
    const read = { documentType: 'OTHER', confidence: 0, supplier: 'TNEB', documentNumber: null, documentDate: null, periodStart: '2023-10-01', periodEnd: null, activityDate: null, quantity: '1350000', unit: 'kWh', material: null, site: null, otherItems: null, density: '0.84 kg/l', supplierFactor: null,
      customerName: null, meterPrevious: null, meterCurrent: null, ncv: null, totalAmount: null, taxAmount: null, currency: null }
    assert.deepEqual(d.result, { ...read, invoices: [read] })
    assert.equal(d.stage, 'NEEDS_CORRECTION') // no end date, low confidence
    const usage = await db.aiUsageEvent.findFirstOrThrow({ where: { documentId: d.id } })
    assert.equal(usage.success, true); assert.equal(usage.inputTokens, 1000); assert.equal(usage.outputTokens, 200)
    assert.equal(usage.estimatedCostUsd?.toString(), '0.0014') // (1000×1 + 200×2) / 1,000,000
    assert.equal(seen[0].key, KEY)
    assert.ok(!seen[0].url.includes(KEY))
    assert.ok(seen[0].url.includes('test-model:generateContent'))
  })

  const failures: Array<[string, () => void, string]> = [
    ['invalid key', () => { reply = { status: 403, body: {} } }, 'INVALID_KEY'],
    ['quota', () => { reply = { status: 429, body: {} } }, 'QUOTA'],
    ['provider down', () => { reply = { status: 503, body: {} } }, 'UNAVAILABLE'],
    ['timeout', () => { env.AI_TIMEOUT_MS = 50; reply = { ...good({}), delayMs: 400 } }, 'TIMEOUT'],
    ['network failure', () => { env.GEMINI_BASE_URL = 'http://localhost:1' }, 'NETWORK'],
    ['not JSON', () => { reply = { status: 200, body: { candidates: [{ content: { parts: [{ text: 'not json' }] } }] } } }, 'BAD_RESPONSE'],
    ['no key configured', () => { env.GEMINI_API_KEY = undefined }, 'NOT_CONFIGURED'],
    ['no model configured', () => { env.AI_MODEL = undefined }, 'NOT_CONFIGURED'],
    ['unknown provider', () => { env.AI_PROVIDER = 'nope' }, 'NOT_CONFIGURED'],
  ]
  for (const [name, arrange, code] of failures) {
    test(`${name}: the file is kept, the failure is recorded, and it can be retried`, async () => {
      arrange()
      const data = pdf()
      const up = await upload(entry, 'bill.pdf', data)
      assert.equal(up.status, 201)
      const d = await settled(entry, up.body.id)
      assert.equal(d.status, 'FAILED')
      assert.ok(d.errorMessage.includes('saved'))
      assert.ok(!JSON.stringify(d).includes(KEY))
      assert.equal((await db.intakeDocument.findUniqueOrThrow({ where: { id: d.id } })).errorCode, code)
      const file = await entry.raw(`/api/documents/${d.id}/file`)
      assert.deepEqual(Buffer.from(await file.arrayBuffer()), data)

      Object.assign(env, { AI_PROVIDER: 'gemini', AI_MODEL: 'test-model', GEMINI_API_KEY: KEY, GEMINI_BASE_URL: `http://localhost:${(stub.address() as AddressInfo).port}`, AI_TIMEOUT_MS: 2000 })
      reply = good({ documentType: 'FUEL_INVOICE', confidence: 0.8, quantity: '8000', unit: 'l' })
      assert.equal((await entry.post(`/api/documents/${d.id}/retry`)).status, 202)
      const again = await settled(entry, d.id)
      assert.equal(again.status, 'EXTRACTED')
      assert.equal(again.result.quantity, '8000')
      assert.equal(again.attempts, 2)
    })
  }

  test('a document that was read cannot be retried; the daily limit stops further calls', async () => {
    const up = await upload(entry)
    await settled(entry, up.body.id)
    assert.equal((await entry.post(`/api/documents/${up.body.id}/retry`)).status, 409)
    env.AI_DAILY_LIMIT_PER_ORG = 1
    assert.equal((await upload(entry)).status, 429)
  })
})

describe('uploads and access', () => {
  test('wrong types, mismatched content, empty files and duplicates are refused', async () => {
    assert.equal((await upload(entry, 'run.exe', Buffer.from('MZ'))).status, 400)
    assert.equal((await upload(entry, 'sheet.xlsx', Buffer.from([0x50, 0x4b, 3, 4]))).status, 400)
    assert.equal((await upload(entry, 'fake.pdf', Buffer.from('not a pdf'))).status, 400)
    const data = pdf()
    const first = await upload(entry, 'a.pdf', data)
    assert.equal(first.status, 201)
    await settled(entry, first.body.id)
    assert.equal((await upload(entry, 'b.pdf', data)).status, 409)
  })

  test('verifiers and reviewers have no access; other organisations see nothing', async () => {
    const up = await upload(entry)
    await settled(entry, up.body.id)
    for (const c of [reviewer, verifier]) {
      assert.equal((await c.get('/api/documents')).status, 403)
      assert.equal((await c.get(`/api/documents/${up.body.id}`)).status, 403)
    }
    assert.equal((await foreign.get(`/api/documents/${up.body.id}`)).status, 404)
    assert.equal((await foreign.post(`/api/documents/${up.body.id}/retry`)).status, 404)
    assert.equal((await foreign.del(`/api/documents/${up.body.id}`)).status, 404)
    assert.equal((await foreign.raw(`/api/documents/${up.body.id}/file`)).status, 404)
    assert.ok(!(await foreign.get('/api/documents')).body.rows.some((r: { id: string }) => r.id === up.body.id))
  })

  test('attaching makes evidence on the person\'s own draft, once; delete removes the intake copy only', async () => {
    const f = await db.facility.create({ data: { organizationId: org.id, code: 'F1', name: 'Plant' } })
    const p = await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'P1', startDate: new Date('2023-04-01'), endDate: new Date('2024-03-31') } })
    const s = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: f.id, name: 'Src', category: 'PURCHASED_ELECTRICITY', activityCode: 'A-GRID' } })
    const rec = await entry.post('/api/activities', { facilityId: f.id, reportingPeriodId: p.id, emissionSourceId: s.id, startDate: '2023-10-01', endDate: '2023-10-31', quantity: '10', unit: 'kWh' })
    assert.equal(rec.status, 201)
    const up = await upload(entry)
    await settled(entry, up.body.id)
    assert.equal((await entry.post(`/api/documents/${up.body.id}/link`, { activityRecordId: rec.body.id })).status, 204)
    assert.equal((await entry.post(`/api/documents/${up.body.id}/link`, { activityRecordId: rec.body.id })).status, 409)
    assert.equal(await db.evidence.count({ where: { activityRecordId: rec.body.id } }), 1)
    assert.equal((await entry.del(`/api/documents/${up.body.id}`)).status, 204)
    assert.equal(await db.evidence.count({ where: { activityRecordId: rec.body.id } }), 1)
    assert.equal((await entry.get(`/api/documents/${up.body.id}`)).status, 404)
  })
})

describe('document intelligence', () => {
  const setup = async (name: string) => {
    const f = await db.facility.create({ data: { organizationId: org.id, code: name, name: `Plant ${name}` } })
    const p = await db.reportingPeriod.findFirst({ where: { organizationId: org.id } }) ?? await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'P1', startDate: new Date('2023-04-01'), endDate: new Date('2024-03-31') } })
    const s = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: f.id, name: `Grid ${name}`, category: 'PURCHASED_ELECTRICITY', activityCode: 'A-GRID' } })
    return { f, p, s }
  }
  const bill = (n: string, extra: Record<string, unknown> = {}) => ({ documentType: 'ELECTRICITY_BILL', confidence: 0.95, supplier: 'Deccan Grid', documentNumber: n, periodStart: '2023-11-01', periodEnd: '2023-11-30', quantity: '5000', unit: 'kWh', ...extra })

  test('several invoices in one file are read separately and matched one by one, with corrections recorded', async () => {
    const { f, p, s } = await setup('M1')
    reply = good({ invoices: [bill('INV-1', { totalAmount: '1,20,000', currency: 'INR', meterPrevious: '1000', meterCurrent: '6000' }), bill('INV-2', { quantity: '7000', periodStart: '2023-12-01', periodEnd: '2023-12-31' })] })
    const up = await upload(entry)
    const d = await settled(entry, up.body.id)
    assert.equal(d.invoiceCount, 2); assert.equal(d.stage, 'AWAITING_REVIEW')
    assert.equal(d.invoices[0].totalAmount, '120000'); assert.equal(d.invoices[0].meterCurrent, '6000')
    assert.equal(d.invoices[1].quantity, '7000')

    const rec = await entry.post('/api/activities', { facilityId: f.id, reportingPeriodId: p.id, emissionSourceId: s.id, startDate: '2023-11-01', endDate: '2023-11-30', quantity: '5100', unit: 'kWh' })
    assert.equal((await entry.post(`/api/documents/${d.id}/link`, { activityRecordId: rec.body.id, invoiceIndex: 0 })).status, 204)
    assert.equal((await entry.post(`/api/documents/${d.id}/link`, { activityRecordId: rec.body.id, invoiceIndex: 0 })).status, 409)
    assert.equal((await entry.post(`/api/documents/${d.id}/link`, { activityRecordId: rec.body.id, invoiceIndex: 5 })).status, 400)
    let after = (await entry.get(`/api/documents/${d.id}`)).body
    assert.equal(after.stage, 'AWAITING_REVIEW') // invoice 2 still open
    assert.deepEqual(after.corrections.map((c: { field: string; before: string; after: string }) => [c.field, c.before, c.after]), [['quantity', '5000', '5100']])

    // Invoice 2 already exists as a record: it is offered as a match, and approved records are matched without being changed.
    const rec2 = await entry.post('/api/activities', { facilityId: f.id, reportingPeriodId: p.id, emissionSourceId: s.id, startDate: '2023-12-01', endDate: '2023-12-31', quantity: '7000', unit: 'kWh' })
    await db.activityRecord.update({ where: { id: rec2.body.id }, data: { status: 'APPROVED' } })
    after = (await entry.get(`/api/documents/${d.id}`)).body
    assert.ok(after.candidates[1].some((r: { id: string }) => r.id === rec2.body.id))
    assert.equal((await entry.post(`/api/documents/${d.id}/link`, { activityRecordId: rec2.body.id, invoiceIndex: 1 })).status, 204)
    assert.equal(await db.evidence.count({ where: { activityRecordId: rec2.body.id } }), 0)
    after = (await entry.get(`/api/documents/${d.id}`)).body
    assert.equal(after.stage, 'MATCHED') // one record is still a draft
    await entry.post(`/api/activities/${rec.body.id}/submit`)
    assert.equal((await entry.get(`/api/documents/${d.id}`)).body.stage, 'SUBMITTED')
  })

  test('same supplier and invoice number is flagged as a possible duplicate; a known supplier suggests its last facility and source', async () => {
    const { f, p, s } = await setup('M2')
    reply = good(bill('DUP-9', { supplier: 'Repeat Power', periodStart: '2023-10-01', periodEnd: '2023-10-31' }))
    const a = await settled(entry, (await upload(entry)).body.id)
    assert.equal(a.duplicateOfId, null)
    const rec = await entry.post('/api/activities', { facilityId: f.id, reportingPeriodId: p.id, emissionSourceId: s.id, startDate: '2023-10-01', endDate: '2023-10-31', quantity: '5000', unit: 'kWh' })
    await entry.post(`/api/documents/${a.id}/link`, { activityRecordId: rec.body.id })
    const b = (await entry.get(`/api/documents/${(await settled(entry, (await upload(entry)).body.id)).id}`)).body
    assert.equal(b.duplicateOf.id, a.id)
    assert.equal(b.recurring.facilityId, f.id); assert.equal(b.recurring.emissionSourceId, s.id); assert.equal(b.recurring.count, 1)
  })

  test('a person can correct the category and reject or restore a document; both are recorded', async () => {
    const d = await settled(entry, (await upload(entry)).body.id)
    assert.equal((await entry.patch(`/api/documents/${d.id}/category`, { category: 'WATER_BILL' })).status, 204)
    assert.equal((await entry.patch(`/api/documents/${d.id}/category`, { category: 'MADE_UP' })).status, 400)
    const after = (await entry.get(`/api/documents/${d.id}`)).body
    assert.equal(after.category, 'WATER_BILL')
    assert.deepEqual([after.corrections[0].field, after.corrections[0].before, after.corrections[0].after], ['documentType', 'ELECTRICITY_BILL', 'WATER_BILL'])
    assert.equal((await entry.post(`/api/documents/${d.id}/reject`, {})).status, 400)
    assert.equal((await entry.post(`/api/documents/${d.id}/reject`, { reason: 'Not our site' })).status, 204)
    assert.equal((await entry.get(`/api/documents/${d.id}`)).body.stage, 'REJECTED')
    assert.equal((await entry.post(`/api/documents/${d.id}/reject?undo=1`, {})).status, 204)
    assert.notEqual((await entry.get(`/api/documents/${d.id}`)).body.stage, 'REJECTED')
    assert.equal(await db.auditLog.count({ where: { entityId: d.id, action: { in: ['document.recategorised', 'document.rejected', 'document.restored'] } } }), 3)
    assert.equal((await foreign.patch(`/api/documents/${d.id}/category`, { category: 'OTHER' })).status, 404)
    assert.equal((await reviewer.post(`/api/documents/${d.id}/reject`, { reason: 'x' })).status, 403)
  })

  test('the platform-wide daily cap stops further reading', async () => {
    env.AI_DAILY_LIMIT_PLATFORM = 1
    try { assert.equal((await upload(entry)).status, 429) } finally { env.AI_DAILY_LIMIT_PLATFORM = 2000 }
  })
})

describe('platform AI status', () => {
  test('only Super Admins; the key never appears; connection test reports each failure', async () => {
    assert.equal((await entry.get('/api/platform/ai')).status, 403)
    const s = await superAdmin.get('/api/platform/ai')
    assert.equal(s.status, 200)
    assert.equal(s.body.keySet, true)
    assert.equal(s.body.model, 'test-model')
    assert.ok(s.body.allTime.calls > 0)
    assert.ok(!JSON.stringify(s.body).includes(KEY))

    reply = { status: 200, body: { name: 'models/test-model' } }
    assert.equal((await superAdmin.post('/api/platform/ai/test')).body.ok, true)
    reply = { status: 403, body: { error: { message: KEY } } }
    const bad = await superAdmin.post('/api/platform/ai/test')
    assert.equal(bad.body.ok, false); assert.equal(bad.body.code, 'INVALID_KEY')
    assert.ok(!JSON.stringify(bad.body).includes(KEY))
    env.GEMINI_API_KEY = undefined
    assert.equal((await superAdmin.post('/api/platform/ai/test')).body.code, 'NOT_CONFIGURED')
  })
})

describe('OpenAI provider', () => {
  const ok = (fields: Record<string, unknown>): Reply => ({ status: 200, body: { output: [{ content: [{ type: 'output_text', text: JSON.stringify(fields) }] }], usage: { input_tokens: 300, output_tokens: 40 } } })
  beforeEach(() => { Object.assign(env, { AI_PROVIDER: 'openai', AI_MODEL: 'test-nano', OPENAI_API_KEY: KEY, OPENAI_BASE_URL: `http://localhost:${(stub.address() as AddressInfo).port}` }) })

  test('reads a document and records usage; switching provider needs configuration only', async () => {
    reply = ok({ documentType: 'FUEL_INVOICE', confidence: 0.9, supplier: null, documentNumber: null, documentDate: null, periodStart: null, periodEnd: null, quantity: '8000', unit: 'l', material: null, site: null })
    const d = await settled(entry, (await upload(entry)).body.id)
    assert.equal(d.status, 'EXTRACTED'); assert.equal(d.result.quantity, '8000')
    const usage = await db.aiUsageEvent.findFirstOrThrow({ where: { documentId: d.id } })
    assert.equal(usage.provider, 'openai'); assert.equal(usage.inputTokens, 300); assert.equal(usage.outputTokens, 40)
    assert.ok(seen[0].url.endsWith('/responses')); assert.ok(!seen[0].url.includes(KEY))
  })

  test('a refused key, or no key, keeps the file and reports the reason', async () => {
    reply = { status: 401, body: {} }
    const a = await settled(entry, (await upload(entry)).body.id)
    assert.equal((await db.intakeDocument.findUniqueOrThrow({ where: { id: a.id } })).errorCode, 'INVALID_KEY')
    env.OPENAI_API_KEY = undefined
    const b = await settled(entry, (await upload(entry)).body.id)
    assert.equal((await db.intakeDocument.findUniqueOrThrow({ where: { id: b.id } })).errorCode, 'NOT_CONFIGURED')
    assert.equal((await superAdmin.get('/api/platform/ai')).body.keySet, false)
  })
})
