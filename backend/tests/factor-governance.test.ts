// TC-ARC-006 review: approval cannot be bypassed through the API, tenant factors never cross tenants (calculations
// and Super Admin views included), O-4, the per-result factor snapshot, selection priority, and the platform
// rule that open periods keep the edition in force at their start.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { selectFactor } from '../src/calc/core/factors.js'
import type { FactorRow } from '../src/calc/core/types.js'
import { getPrisma } from '../src/config/database.js'
import { makeOrg, signInAs, signInSuperAdmin, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
type Client = Awaited<ReturnType<typeof signInSuperAdmin>>
let sa: Client
before(async () => { sa = await signInSuperAdmin(base) })

const CHECKS = { checks: { source: true, units: true, tier: true, validity: true } }
const pdf = Buffer.from('%PDF-1.4 evidence')
const steam = { activityCode: 'A-STEAM', gas: 'CO2e', value: '60', numeratorUnit: 'kg CO2e', denominatorUnit: 'GJ', source: 'Supplier disclosure', sourceVersion: '2025', validFrom: '2025-04-01', validTo: '2026-03-31', geography: 'Site', tier: 'Tier 3 site-specific', basis: 'Supplier disclosure for this site only; not valid for other suppliers.' }

async function setup(name: string) {
  const org = await makeOrg(name)
  const facility = await db.facility.create({ data: { organizationId: org.id, name: 'Plant', code: 'P1', country: 'India', gridLocation: 'India - National Average' } })
  const period = await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'FY2025-26', startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31') } })
  const admin = await signInAs(base, org.id, 'TENANT_ADMIN')
  return { org, facility, period, admin }
}
type Setup = Awaited<ReturnType<typeof setup>>
async function record(s: Setup, activityCode: string, category: 'PURCHASED_ENERGY' | 'PROCESS' | 'PURCHASED_ELECTRICITY', quantity: string, unit: string, parameters: object = {}) {
  const src = await db.emissionSource.create({ data: { organizationId: s.org.id, facilityId: s.facility.id, name: `${activityCode} source`, category, activityCode } })
  return db.activityRecord.create({ data: {
    organizationId: s.org.id, facilityId: s.facility.id, reportingPeriodId: s.period.id, emissionSourceId: src.id, startDate: new Date('2025-04-01'), endDate: new Date('2025-04-30'),
    quantity, unit, parameters, status: 'APPROVED', createdById: s.admin.user.id, updatedById: s.admin.user.id,
  } })
}
const run = async (s: Setup) => (await s.admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body

describe('approval cannot be bypassed', () => {
  test('a client-sent status is ignored; only a reviewer approves, and only a factor under review; drafts are never calculated', async () => {
    const s = await setup('Bypass Org')
    const entry = await signInAs(base, s.org.id, 'DATA_ENTRY')
    const reviewer = await signInAs(base, s.org.id, 'REVIEWER')
    const created = (await entry.post('/api/emission-factors', { ...steam, code: 'BYP-1', status: 'APPROVED', organizationId: null })).body
    assert.deepEqual([created.status, created.organizationId], ['DRAFT', s.org.id]) // unknown fields are dropped
    assert.equal((await entry.patch(`/api/emission-factors/${created.id}`, { status: 'APPROVED' })).body.status, 'DRAFT')
    assert.equal((await reviewer.post(`/api/emission-factors/${created.id}/approve`, CHECKS)).status, 409) // drafts skip nothing
    await record(s, 'A-STEAM', 'PURCHASED_ENERGY', '100', 'GJ')
    assert.equal((await run(s)).blockedCount, 1) // a draft is never used

    await entry.upload(`/api/emission-factors/${created.id}/evidence`, 'd.pdf', pdf)
    assert.equal((await entry.post(`/api/emission-factors/${created.id}/submit`)).body.status, 'IN_REVIEW')
    assert.equal((await run(s)).blockedCount, 1) // nor a factor under review
    assert.equal((await entry.post(`/api/emission-factors/${created.id}/approve`, CHECKS)).status, 403)
    assert.equal((await s.admin.post(`/api/emission-factors/${created.id}/approve`, CHECKS)).status, 403)
    assert.equal((await sa.post(`/api/emission-factors/${created.id}/approve`, CHECKS)).status, 404)
    assert.equal((await reviewer.post(`/api/emission-factors/${created.id}/approve`, CHECKS)).body.status, 'APPROVED')
    assert.equal((await run(s)).calculatedCount, 1)
  })
})

describe('O-4: no reviewer, no approval', () => {
  test('without another reviewer the factor cannot leave draft, even when its creator is a reviewer', async () => {
    const s = await setup('No Reviewer Org')
    const f = (await s.admin.post('/api/emission-factors', { ...steam, code: 'NOREV-1' })).body
    await s.admin.upload(`/api/emission-factors/${f.id}/evidence`, 'd.pdf', pdf)
    const refused = await s.admin.post(`/api/emission-factors/${f.id}/submit`)
    assert.equal(refused.status, 409)
    assert.match(refused.body.error, /no other reviewer/)

    const onlyReviewer = await signInAs(base, s.org.id, 'REVIEWER')
    const own = (await onlyReviewer.post('/api/emission-factors', { ...steam, code: 'NOREV-2', validFrom: '2026-04-01', validTo: null })).body
    await onlyReviewer.upload(`/api/emission-factors/${own.id}/evidence`, 'd.pdf', pdf)
    assert.equal((await onlyReviewer.post(`/api/emission-factors/${own.id}/submit`)).status, 409) // they could not approve their own
    assert.equal((await s.admin.post(`/api/emission-factors/${f.id}/submit`)).body.status, 'IN_REVIEW') // now someone else can review it
    assert.equal((await db.emissionFactor.findUnique({ where: { id: own.id } }))!.status, 'DRAFT')
  })
})

describe('tenant factors never cross tenants', () => {
  test('a calculation cannot use another tenant\'s factor, even when its record names that factor', async () => {
    const a = await setup('Isolation A')
    const b = await setup('Isolation B')
    const own = await db.emissionFactor.create({ data: {
      code: 'LIME-A-SITE', activityCode: 'A-PR-LIME-PRODU', gas: 'CO2', value: '0.9', numeratorUnit: 'tCO2', denominatorUnit: 'tonne lime', carbonOrigin: 'Fossil',
      source: 'Site lab report', sourceVersion: '2025', validFrom: new Date('2025-04-01'), geography: 'Site', tier: 'Tier 3 site-specific', status: 'APPROVED', organizationId: a.org.id,
    } })
    await record(a, 'A-PR-LIME-PRODU', 'PROCESS', '100', 't', { factorCode: 'LIME-A-SITE' })
    await record(b, 'A-PR-LIME-PRODU', 'PROCESS', '100', 't', { factorCode: 'LIME-A-SITE' })
    const runB = await run(b)
    const resultB = await db.calculationResult.findFirst({ where: { runId: runB.id } })
    assert.notEqual(resultB!.emissionFactorId, own.id)
    assert.equal((await db.emissionFactor.findUnique({ where: { id: own.id } }))!.status, 'APPROVED') // B's run did not touch it

    const runA = await run(a)
    const resultA = await db.calculationResult.findFirst({ where: { runId: runA.id } })
    assert.equal(resultA!.emissionFactorId, own.id)
    assert.equal((await db.emissionFactor.findUnique({ where: { id: own.id } }))!.status, 'IN_USE')
    assert.equal((await b.admin.get(`/api/reference/emission-factors/${own.id}/versions`)).status, 404)
    assert.equal((await b.admin.raw(`/api/reference/emission-factors/${own.id}/evidence`)).status, 404)
  })

  test('Super Admin audit views show that a tenant factor event happened, never its content', async () => {
    const s = await setup('Audit Privacy Org')
    const f = (await s.admin.post('/api/emission-factors', { ...steam, code: 'PRIV-1', source: 'Confidential supplier contract 7781' })).body
    const views = [
      (await sa.get(`/api/platform/audit?organizationId=${s.org.id}`)).body.rows,
      (await sa.get(`/api/platform/organizations/${s.org.id}`)).body.audit,
      (await sa.get(`/api/platform/users/${s.admin.user.id}`)).body.audit,
    ]
    for (const rows of views) {
      const event = rows.find((r: { entityId: string }) => r.entityId === f.id)
      assert.ok(event, 'the event is listed')
      assert.deepEqual([event.after, event.before, event.redacted], [null, null, true])
      assert.doesNotMatch(JSON.stringify(rows), /Confidential supplier contract/)
    }
  })
})

describe('snapshots and selection', () => {
  test('each result stores the factor as used: value, units, code, edition, source and library', async () => {
    const s = await setup('Snapshot Org')
    await signInAs(base, s.org.id, 'REVIEWER')
    const reviewer = await signInAs(base, s.org.id, 'REVIEWER')
    const f = (await s.admin.post('/api/emission-factors', { ...steam, code: 'SNAP-1' })).body
    await s.admin.upload(`/api/emission-factors/${f.id}/evidence`, 'd.pdf', pdf)
    await s.admin.post(`/api/emission-factors/${f.id}/submit`)
    await reviewer.post(`/api/emission-factors/${f.id}/approve`, CHECKS)
    await record(s, 'A-STEAM', 'PURCHASED_ENERGY', '100', 'GJ')
    const r = await db.calculationResult.findFirst({ where: { runId: (await run(s)).id } })
    assert.deepEqual([r!.factorValue!.toString(), r!.factorUnit], ['60', 'kg CO2e / GJ'])
    assert.deepEqual((r!.selection as { factorSnapshot: unknown }).factorSnapshot, {
      code: 'SNAP-1', source: 'Supplier disclosure', sourceVersion: '2025', tier: 'Tier 3 site-specific', library: 'Tenant-defined · Tier 3 site-specific', validFrom: '2025-04-01', validTo: '2026-03-31',
    })
  })

  test('selection: the organisation\'s own factor before the platform default; among equals, the latest in force at the period start', () => {
    const base = { activityCode: 'A-X', gas: 'CO2', numeratorUnit: 't', denominatorUnit: 't', carbonOrigin: 'Fossil', source: 's', sourceVersion: 'v', tier: 'Tier 1 default', regionCode: null, createdAt: new Date('2026-01-01'), validTo: null, status: 'APPROVED' }
    const f = (id: string, from: string, org: string | null): FactorRow => ({ ...base, id, code: id, value: '1', validFrom: new Date(from), organizationId: org })
    const start = new Date('2025-04-01')
    assert.equal(selectFactor([f('P-OLD', '2020-01-01', null), f('P-NEW', '2024-01-01', null)], ['A-X'], null, start).factor!.id, 'P-NEW')
    assert.equal(selectFactor([f('P-NEW', '2024-01-01', null), f('T-1', '2022-01-01', 'org')], ['A-X'], null, start).factor!.id, 'T-1')
    assert.equal(selectFactor([f('P-NEW', '2024-01-01', null), f('T-LATER', '2025-06-01', 'org')], ['A-X'], null, start).factor!.id, 'P-NEW') // not yet in force
  })

  test('platform library: an open period keeps the edition in force at its start after a new edition is published', async () => {
    const s = await setup('Pinned Edition Org')
    await record(s, 'A-GRID', 'PURCHASED_ELECTRICITY', '1000', 'MWh')
    const grid = { activityCode: 'A-GRID', regionCode: 'IN-ALL', numeratorUnit: 'tCO2e', denominatorUnit: 'MWh', source: 'CEA CO2 Baseline Database', geography: 'India', tier: 'Tier 2 country' }
    const v1 = (await sa.post('/api/platform/emission-factors', { ...grid, code: 'PIN-V1', value: '0.7', sourceVersion: 'v22', validFrom: '2025-04-01' })).body
    await sa.post(`/api/emission-factors/${v1.id}/approve`, CHECKS)
    assert.equal(Number((await run(s)).scope2LocationTCO2e), 700)

    const v2 = (await sa.post('/api/platform/emission-factors', { ...grid, code: 'PIN-V2', value: '0.6', sourceVersion: 'v23', validFrom: '2025-10-01', supersedesId: v1.id })).body
    await sa.post(`/api/emission-factors/${v2.id}/approve`, CHECKS)
    const old = (await db.emissionFactor.findUnique({ where: { id: v1.id } }))!
    assert.deepEqual([old.status, old.validTo!.toISOString().slice(0, 10)], ['SUPERSEDED', '2025-09-30'])
    const again = await run(s)
    assert.equal(Number(again.scope2LocationTCO2e), 700) // still the edition in force on 2025-04-01
    assert.equal((await db.calculationResult.findFirst({ where: { runId: again.id, formulaCode: 'C-06' } }))!.emissionFactorId, v1.id)

    // Ended without a replacement: not selected any more.
    await sa.post(`/api/emission-factors/${v2.id}/supersede`, { reason: 'cleanup after test' })
    await db.emissionFactor.update({ where: { id: v1.id }, data: { supersedesId: null } })
    await db.emissionFactor.updateMany({ where: { id: v2.id }, data: { supersedesId: null } })
    assert.equal((await run(s)).blockedCount, 1)
  })
})
