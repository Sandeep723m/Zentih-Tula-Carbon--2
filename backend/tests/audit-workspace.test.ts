import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { after, before, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { storage } from '../src/storage/index.js'
import { makeOrg, makeUser, signInAs, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
type Client = Awaited<ReturnType<typeof signInAs>>
let admin: Client, verifier: Client, ungranted: Client, entry: Client, foreign: Client
let periodId = '', approvedId = '', submittedId = ''

before(async () => {
  const org = await makeOrg('Audit Co')
  admin = await signInAs(base, org.id, 'TENANT_ADMIN')
  verifier = await signInAs(base, org.id, 'VERIFIER')
  ungranted = await signInAs(base, org.id, 'VERIFIER')
  entry = await signInAs(base, org.id, 'DATA_ENTRY')
  foreign = await signInAs(base, (await makeOrg('Audit Other')).id, 'TENANT_ADMIN')
  const u = await makeUser()
  const f = await db.facility.create({ data: { organizationId: org.id, code: 'PA', name: 'Plant A' } })
  const p = await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'FY 2023-24', startDate: new Date('2023-04-01'), endDate: new Date('2024-03-31') } })
  periodId = p.id
  const s = await db.emissionSource.create({ data: { organizationId: org.id, facilityId: f.id, name: 'DG set', category: 'FUEL_COMBUSTION' } })
  const rec = (q: string, status: 'APPROVED' | 'SUBMITTED') => db.activityRecord.create({ data: { organizationId: org.id, facilityId: f.id, reportingPeriodId: p.id, emissionSourceId: s.id, startDate: new Date('2023-10-01'), endDate: new Date('2023-10-31'), quantity: q, unit: 'l', status, createdById: u.id, updatedById: u.id } })
  approvedId = (await rec('3000', 'APPROVED')).id
  submittedId = (await rec('2500', 'SUBMITTED')).id
  await storage.put(`${org.id}/ev1`, Buffer.from('%PDF-1.4 bill'))
  await db.evidence.create({ data: { organizationId: org.id, activityRecordId: approvedId, fileName: 'bill.pdf', mimeType: 'application/pdf', sizeBytes: 13, sha256: 'x', storageKey: `${org.id}/ev1`, uploadedById: u.id } })
  await db.verificationQuery.create({ data: { organizationId: org.id, reportingPeriodId: p.id, activityRecordId: approvedId, subject: 'Density?', raisedById: u.id } })
  const vid = (await verifier.get('/api/auth/me')).body.user.id
  await db.verifierGrant.create({ data: { organizationId: org.id, userId: vid, reportingPeriodId: p.id, grantedById: u.id } })
})

test('readiness shows separate indicators; verifiers count approved records only', async () => {
  const a = (await admin.get(`/api/audit-workspace/readiness?reportingPeriodId=${periodId}`)).body.indicators
  assert.deepEqual([a.submitted, a.withEvidence, a.withoutEvidence, a.approved, a.awaiting, a.openQueries], [2, 1, 1, 1, 1, 1])
  const v = (await verifier.get(`/api/audit-workspace/readiness?reportingPeriodId=${periodId}`)).body.indicators
  assert.equal(v.submitted, 1); assert.equal(v.awaiting, 0)
})

test('sampling filters by risk and size', async () => {
  const missing = (await admin.get(`/api/audit-workspace/sample?reportingPeriodId=${periodId}&risk=missingEvidence`)).body
  assert.deepEqual(missing.rows.map((r: { id: string }) => r.id), [submittedId])
  const open = (await admin.get(`/api/audit-workspace/sample?reportingPeriodId=${periodId}&risk=openQuery`)).body
  assert.deepEqual(open.rows.map((r: { id: string }) => r.id), [approvedId])
  const one = (await admin.get(`/api/audit-workspace/sample?reportingPeriodId=${periodId}&size=1`)).body
  assert.equal(one.population, 2); assert.equal(one.rows.length, 1)
})

test('the evidence pack is a valid zip with records, history, queries and the files; verifiers get approved records only', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'pack-'))
  const get = async (c: Client) => { const r = await c.raw(`/api/audit-workspace/evidence-pack?reportingPeriodId=${periodId}`); return { status: r.status, data: Buffer.from(await r.arrayBuffer()) } }
  const a = await get(admin)
  assert.equal(a.status, 200)
  writeFileSync(join(dir, 'a.zip'), a.data)
  execFileSync('unzip', ['-tq', join(dir, 'a.zip')]) // throws if any entry is corrupt
  const names = execFileSync('unzip', ['-Z1', join(dir, 'a.zip')]).toString().trim().split('\n')
  for (const n of ['README.txt', 'activity-records.csv', 'calculations.csv', 'emission-factors.csv', 'review-history.csv', 'verification-queries.csv', 'audit-trail.csv']) assert.ok(names.includes(n), n)
  assert.ok(names.some((n) => n.startsWith('evidence/') && n.endsWith('/bill.pdf')))
  const records = execFileSync('unzip', ['-p', join(dir, 'a.zip'), 'activity-records.csv']).toString()
  assert.ok(records.includes(approvedId) && records.includes(submittedId))
  const v = await get(verifier)
  writeFileSync(join(dir, 'v.zip'), v.data)
  const vr = execFileSync('unzip', ['-p', join(dir, 'v.zip'), 'activity-records.csv']).toString()
  assert.ok(vr.includes(approvedId) && !vr.includes(submittedId))
  assert.ok(await db.auditLog.findFirst({ where: { action: 'evidence_pack.exported', entityId: periodId } }))
})

test('ungranted verifiers, data entry and other organisations are refused', async () => {
  assert.equal((await ungranted.get(`/api/audit-workspace/readiness?reportingPeriodId=${periodId}`)).status, 404)
  assert.equal((await entry.get(`/api/audit-workspace/readiness?reportingPeriodId=${periodId}`)).status, 403)
  assert.equal((await foreign.raw(`/api/audit-workspace/evidence-pack?reportingPeriodId=${periodId}`)).status, 404)
})
