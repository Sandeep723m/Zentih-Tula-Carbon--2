// Data entry → submit → review → calculation → confirmation → period lock → final report → verification.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { dec } from '../src/calc/core/decimal.js'
import { makeOrg, signInAs, startServer } from './helpers.js'

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
type Client = Awaited<ReturnType<typeof signInAs>>
const near = (actual: unknown, expected: number, tolerance = 0.01) =>
  assert.ok(Math.abs(Number(String(actual)) - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)

async function setup(name: string) {
  const org = await makeOrg(name)
  const facility = await db.facility.create({ data: { organizationId: org.id, name: 'Plant A', code: 'PA', gridLocation: 'India - National Average' } })
  const period = await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'FY2024-25', startDate: new Date('2024-04-01'), endDate: new Date('2025-03-31') } })
  const [grid, diesel, gas] = await Promise.all([
    db.emissionSource.create({ data: { organizationId: org.id, facilityId: facility.id, name: 'Grid', category: 'PURCHASED_ELECTRICITY', activityCode: 'A-GRID' } }),
    db.emissionSource.create({ data: { organizationId: org.id, facilityId: facility.id, name: 'DG set', category: 'FUEL_COMBUSTION', activityCode: 'A-ST-DIESEL-GAS-OIL' } }),
    db.emissionSource.create({ data: { organizationId: org.id, facilityId: facility.id, name: 'Chiller', category: 'FUGITIVE_GAS', activityCode: 'A-FU-R-410A' } }),
  ])
  const [admin, entry, reviewer, verifier] = await Promise.all((['TENANT_ADMIN', 'DATA_ENTRY', 'REVIEWER', 'VERIFIER'] as const).map((r) => signInAs(base, org.id, r)))
  let n = 0 // each record its own day: one source cannot have two submitted records over the same days (V-07)
  const rec = (sourceId: string, quantity: string, unit: string, parameters?: Record<string, unknown>) => {
    const day = new Date(Date.UTC(2024, 3, 1) + n++ * 86_400_000).toISOString().slice(0, 10)
    return { facilityId: facility.id, reportingPeriodId: period.id, emissionSourceId: sourceId, startDate: day, endDate: day, quantity, unit, parameters }
  }
  const submit = async (body: unknown) => {
    const r = await entry.post('/api/activities', body)
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal((await entry.post(`/api/activities/${r.body.id}/submit`)).status, 200)
    return r.body.id as string
  }
  return { org, facility, period, grid, diesel, gas, admin, entry, reviewer, verifier, rec, submit }
}

describe('review and approval', () => {
  let s: Awaited<ReturnType<typeof setup>>
  before(async () => { s = await setup('Review Org') })

  test('approve: only reviewers, only submitted records, never your own, never twice', async () => {
    const id = await s.submit(s.rec(s.grid.id, '1000', 'MWh'))
    assert.equal((await s.entry.post(`/api/activities/${id}/approve`)).status, 403) // data entry lacks the permission
    assert.equal((await s.verifier.post(`/api/activities/${id}/approve`)).status, 403)
    // A Tenant Admin may approve a record they entered themselves.
    const own = await s.admin.post('/api/activities', s.rec(s.grid.id, '5', 'MWh'))
    await s.admin.post(`/api/activities/${own.body.id}/submit`)
    assert.equal((await s.admin.post(`/api/activities/${own.body.id}/approve`)).status, 200)

    const r = await s.reviewer.post(`/api/activities/${id}/approve`)
    assert.equal(r.status, 200)
    assert.equal(r.body.status, 'APPROVED')
    assert.equal((await s.reviewer.post(`/api/activities/${id}/approve`)).status, 409) // already approved
    assert.equal((await s.entry.patch(`/api/activities/${id}`, { quantity: '1' })).status, 409) // frozen
    const draft = await s.entry.post('/api/activities', s.rec(s.grid.id, '1', 'MWh'))
    assert.equal((await s.reviewer.post(`/api/activities/${draft.body.id}/approve`)).status, 409) // drafts cannot be approved
  })

  test('return needs a reason; the creator corrects and resubmits; history and audit keep every step', async () => {
    const id = await s.submit(s.rec(s.grid.id, '2000', 'MWh'))
    assert.equal((await s.reviewer.post(`/api/activities/${id}/return`, { reason: '' })).status, 400)
    const ret = await s.reviewer.post(`/api/activities/${id}/return`, { reason: 'Invoice shows 1,950 MWh' })
    assert.equal(ret.body.status, 'RETURNED')
    assert.equal(ret.body.returnReason, 'Invoice shows 1,950 MWh')
    assert.equal((await s.entry.patch(`/api/activities/${id}`, { quantity: '1950' })).status, 200)
    assert.equal((await s.entry.del(`/api/activities/${id}`)).status, 409) // returned records keep their history
    assert.equal((await s.entry.post(`/api/activities/${id}/submit`)).body.status, 'SUBMITTED')
    assert.equal((await s.reviewer.post(`/api/activities/${id}/approve`)).body.status, 'APPROVED')
    // An approved record can be returned (reopened) while the period is open.
    assert.equal((await s.reviewer.post(`/api/activities/${id}/return`, { reason: 'Meter recalibrated, check again' })).body.status, 'RETURNED')

    const detail = (await s.reviewer.get(`/api/activities/${id}`)).body
    assert.deepEqual(detail.reviews.map((r: { action: string }) => r.action), ['SUBMITTED', 'RETURNED', 'SUBMITTED', 'APPROVED', 'RETURNED'])
    assert.equal(detail.reviews[1].comment, 'Invoice shows 1,950 MWh')
    assert.equal(detail.reviews[1].actor.name, s.reviewer.user.name)
    const actions = (await db.auditLog.findMany({ where: { entityId: id }, orderBy: { createdAt: 'asc' } })).map((a) => a.action)
    assert.deepEqual(actions, ['activity.created', 'activity.submitted', 'activity.returned', 'activity.updated', 'activity.resubmitted', 'activity.approved', 'activity.returned'])
  })

  test('reviewers see the calculation preview, including warnings that approval does not resolve', async () => {
    const id = await s.submit(s.rec(s.diesel.id, '10000', 'l', { density: '0.84', densityUnit: 'kg/l' }))
    const d = (await s.reviewer.get(`/api/activities/${id}`)).body
    assert.equal(d.preview.length, 1)
    assert.equal(d.preview[0].formulaCode, 'C-01')
    near(d.preview[0].tCO2e, 26.8564, 0.001)
    assert.ok(d.preview[0].issues.some((i: { code: string }) => i.code === 'R-03'))
    assert.equal((await s.entry.get(`/api/activities/${id}`)).body.preview, null) // data entry: no preview
  })

  test('a refrigerant mass balance with no top-up (WE-13) saves and calculates', async () => {
    const id = await s.submit(s.rec(s.gas.id, '0', 'kg', { disposedKg: '20', recoveredKg: '18' }))
    assert.equal((await s.reviewer.get(`/api/activities/${id}`)).body.preview[0].tCO2e, '4.511') // 2 kg R-410A x 2255.5 / 1000
  })

  test('record lists carry counts for the status and category tabs, and filter by category', async () => {
    const list = (await s.reviewer.get('/api/activities')).body
    assert.ok(list.counts.status.SUBMITTED >= 1 && list.counts.status.APPROVED >= 1)
    assert.ok(list.counts.category.PURCHASED_ELECTRICITY >= 1 && list.counts.category.FUEL_COMBUSTION >= 1)
    const fuels = (await s.reviewer.get('/api/activities?category=FUEL_COMBUSTION')).body
    assert.ok(fuels.rows.every((r: { emissionSource: { category: string } }) => r.emissionSource.category === 'FUEL_COMBUSTION'))
    assert.equal(fuels.total, list.counts.category.FUEL_COMBUSTION)
    const gwp = (await s.reviewer.get('/api/reference/emission-factors?kind=gwp')).body
    assert.ok(gwp.rows.every((f: { activityCode: string | null }) => f.activityCode === null) && gwp.total === gwp.counts.gwp)
  })

  test('two reviewers approving at once: exactly one succeeds', async () => {
    const id = await s.submit(s.rec(s.grid.id, '3', 'MWh'))
    const other = await signInAs(base, s.org.id, 'REVIEWER')
    const results = await Promise.all([s.reviewer.post(`/api/activities/${id}/approve`), other.post(`/api/activities/${id}/approve`)])
    assert.deepEqual(results.map((r) => r.status).sort(), [200, 409])
    assert.equal(await db.activityReview.count({ where: { activityRecordId: id, action: 'APPROVED' } }), 1)
  })

  test('another organisation cannot review, see or calculate these records', async () => {
    const id = await s.submit(s.rec(s.grid.id, '4', 'MWh'))
    const outsider = await signInAs(base, (await makeOrg('Outsider Org')).id, 'REVIEWER')
    assert.equal((await outsider.post(`/api/activities/${id}/approve`)).status, 404)
    assert.equal((await outsider.get(`/api/activities/${id}`)).status, 404)
    assert.equal((await outsider.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).status, 404)
    assert.equal((await outsider.get(`/api/reporting-periods/${s.period.id}/checklist`)).status, 404)
  })
})

describe('calculation eligibility, period lock and reports', () => {
  test('full close: checklist blocks the lock until everything is resolved; locked periods are frozen; reopen is audited', async () => {
    const s = await setup('Close Org')
    const check = async () => (await s.reviewer.get(`/api/reporting-periods/${s.period.id}/checklist`)).body
    const failing = async () => (await check()).items.filter((i: { ok: boolean; mandatory: boolean }) => i.mandatory && !i.ok).map((i: { key: string }) => i.key)

    const grid = await s.submit(s.rec(s.grid.id, '1200000', 'kWh'))
    const diesel = await s.submit(s.rec(s.diesel.id, '10000', 'l', { density: '0.84', densityUnit: 'kg/l' }))
    const r410 = await s.submit(s.rec(s.gas.id, '12', 'kg'))
    await s.entry.post('/api/activities', s.rec(s.grid.id, '1', 'kWh')) // a draft
    assert.deepEqual(await failing(), ['drafts', 'submitted', 'approved', 'run']) // blocked and warnings are checked after a run
    const pre = (await s.reviewer.get(`/api/calculations/preview?reportingPeriodId=${s.period.id}`)).body
    const fuels = pre.categories.find((c: { category: string }) => c.category === 'FUEL_COMBUSTION')
    assert.deepEqual(fuels.counts, { DRAFT: 0, SUBMITTED: 1, RETURNED: 0, APPROVED: 0 })
    assert.equal((await s.entry.get(`/api/calculations/preview?reportingPeriodId=${s.period.id}`)).status, 403)
    const att = (await s.reviewer.get('/api/attention')).body
    assert.deepEqual(att.periods[0].counts, { draft: 1, submitted: 3, returned: 0, approved: 0, blocked: 0, unconfirmed: 0, notCalculable: 0 })
    assert.ok(att.periods[0].open.some((i: { key: string }) => i.key === 'approved'))
    assert.equal((await s.entry.get('/api/attention')).status, 403)
    const empty = await s.reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id })
    assert.equal(empty.status, 409) // no approved records: no empty run
    assert.match(empty.body.error, /3 awaiting review/)
    assert.equal((await s.reviewer.post(`/api/reporting-periods/${s.period.id}/lock`)).status, 409)

    // Only approved records are calculated.
    for (const id of [grid, diesel]) await s.reviewer.post(`/api/activities/${id}/approve`)
    const pre2 = (await s.reviewer.get(`/api/calculations/preview?reportingPeriodId=${s.period.id}`)).body
    const fuel2 = pre2.categories.find((c: { category: string }) => c.category === 'FUEL_COMBUSTION')
    near(fuel2.estimate.SCOPE1, 26.8564, 0.001) // what the run will give, before running
    assert.equal(fuel2.records[0].results[0].formulaCode, 'C-01')
    const run1 = (await s.reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body
    assert.equal(run1.recordCount, 2) // r410 is still only submitted
    await s.reviewer.post(`/api/activities/${r410}/approve`)
    assert.ok((await failing()).includes('run')) // approved after the run: stale
    const draftId = (await db.activityRecord.findFirstOrThrow({ where: { reportingPeriodId: s.period.id, status: 'DRAFT' } })).id
    assert.equal((await s.entry.del(`/api/activities/${draftId}`)).status, 204)

    const run = (await s.reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body
    assert.equal(run.recordCount, 3)
    near(run.totals.SCOPE1.gross, 26.8564 + 27.066, 0.001) // WE-01 + WE-11 inputs
    near(run.totals.SCOPE2_LOCATION.gross, 852)
    const d = (await s.reviewer.get(`/api/calculations/runs/${run.id}`)).body
    near(d.categories.FUEL_COMBUSTION.lines.SCOPE1.gross, 26.8564, 0.001)
    near(d.categories.FUGITIVE_GAS.lines.SCOPE1.gross, 27.066, 0.001)
    assert.equal(d.categories.PURCHASED_ELECTRICITY.results, 2) // one record, location + market
    assert.equal((await s.reviewer.get(`/api/calculations/runs/${run.id}?category=FUGITIVE_GAS`)).body.results.total, 1)
    assert.deepEqual(await failing(), ['warnings'])

    // Confirm every warning with a reason, then lock.
    // Confirm every warning with a reason: one issue type first, then the rest in one go.
    assert.equal((await s.entry.post(`/api/calculations/runs/${run.id}/confirm`, { reason: 'Looks fine to me' })).status, 403)
    const q02 = await s.reviewer.post(`/api/calculations/runs/${run.id}/confirm`, { reason: 'No Indian residual mix; disclosed', code: 'Q-02' })
    assert.equal(q02.body.confirmed, 1)
    const rest = await s.reviewer.post(`/api/calculations/runs/${run.id}/confirm`, { reason: 'Reviewed against invoices; defaults accepted' })
    assert.ok(rest.body.confirmed >= 1)
    assert.equal((await s.reviewer.post(`/api/calculations/runs/${run.id}/confirm`, { reason: 'again again' })).status, 409)
    assert.deepEqual(await failing(), [])
    assert.equal((await s.entry.post(`/api/reporting-periods/${s.period.id}/lock`)).status, 403)
    const locked = await s.reviewer.post(`/api/reporting-periods/${s.period.id}/lock`)
    assert.equal(locked.status, 200)
    assert.equal(locked.body.finalRunId, run.id)
    assert.equal((await s.reviewer.post(`/api/reporting-periods/${s.period.id}/lock`)).status, 409)

    // Locked: no new records, edits, reviews, runs or confirmations.
    assert.equal((await s.entry.post('/api/activities', s.rec(s.grid.id, '1', 'kWh'))).status, 409)
    assert.equal((await s.reviewer.post(`/api/activities/${grid}/return`, { reason: 'Too late?' })).status, 409)
    assert.equal((await s.reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).status, 409)
    assert.equal((await s.admin.patch(`/api/reporting-periods/${s.period.id}`, { name: 'x' })).status, 409)

    // Final report = the locked run.
    const rep = (await s.reviewer.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}`)).body
    assert.equal(rep.status, 'FINAL')
    assert.equal(rep.run.id, run.id)
    near(rep.totals.SCOPE2_MARKET.gross, 852) // market-based beside location-based, never added
    assert.deepEqual(rep.methodology.map((m: { formulaCode: string }) => m.formulaCode), ['C-01', 'C-05', 'C-06', 'C-07'])
    assert.ok(rep.factors.some((f: { code: string }) => f.code === 'EF-0289') && rep.factors.some((f: { code: string }) => f.code === 'EF-0303'))
    assert.ok(Number(rep.gases.CO2) > 26000 && Number(rep.gases['A-FU-R-410A']) === 12)

    // Reopen: Tenant Admin only, with a reason; the final run is kept but no longer final.
    assert.equal((await s.reviewer.post(`/api/reporting-periods/${s.period.id}/reopen`, { reason: 'Late invoice for March arrived' })).status, 403)
    assert.equal((await s.admin.post(`/api/reporting-periods/${s.period.id}/reopen`, { reason: 'short' })).status, 400)
    assert.equal((await s.admin.post(`/api/reporting-periods/${s.period.id}/reopen`, { reason: 'Late invoice for March arrived' })).body.status, 'OPEN')
    assert.equal((await s.reviewer.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}`)).body.status, 'PROVISIONAL')
    assert.ok(await db.calculationRun.findUnique({ where: { id: run.id } }))
    const events = (await check()).events.map((e: { action: string; reason: string | null }) => [e.action, e.reason])
    assert.deepEqual(events, [['REOPENED', 'Late invoice for March arrived'], ['LOCKED', null]])
    assert.ok(await db.auditLog.findFirst({ where: { action: 'period.reopened', entityId: s.period.id, reason: 'Late invoice for March arrived' } }))
  })

  test('report: rounding once from unrounded values, gross and counted apart, filters, CSV export audited', async () => {
    const s = await setup('Report Org')
    const b = await db.facility.create({ data: { organizationId: s.org.id, name: 'Plant B', code: 'PB', gridLocation: 'India - National Average' } })
    const gridB = await db.emissionSource.create({ data: { organizationId: s.org.id, facilityId: b.id, name: 'Grid', category: 'PURCHASED_ELECTRICITY', activityCode: 'A-GRID' } })
    await db.orgBoundary.create({
      data: {
        organizationId: s.org.id, version: 1, approach: 'EQUITY', status: 'APPROVED', effectiveFrom: new Date('2024-04-01'), baseYear: 2024, approvedAt: new Date(),
        snapshot: [s.facility.id, b.id].map((id, i) => ({ id, equityShare: i ? 40 : 100, operationalControl: null, financialControl: null, scope1Active: true, scope2Active: true })),
      },
    })
    assert.equal((await s.reviewer.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}`)).status, 404) // no run yet
    for (const body of [s.rec(s.grid.id, '1234567.891', 'kWh'), { ...s.rec(gridB.id, '1000', 'MWh'), facilityId: b.id }]) {
      await s.reviewer.post(`/api/activities/${await s.submit(body)}/approve`)
    }
    await s.reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id })

    const rep = (await s.reviewer.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}&scope=2`)).body
    assert.equal(rep.status, 'PROVISIONAL')
    assert.equal(rep.totals.SCOPE2_LOCATION.gross, '1586.54320261') // stored unrounded: 876.54320261 + 710
    assert.equal(rep.totals.SCOPE2_LOCATION.counted, '1160.54320261') // 100% + 40%
    assert.equal(rep.totals.SCOPE1, undefined) // scope filter
    assert.equal(rep.boundary.version, 1)
    const all = (await s.reviewer.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}`)).body
    assert.equal(all.totals.S1_S2_LOCATION.gross, '1586.54320261') // G-07: Scope 1 (0) + location + steam (0)
    assert.equal(all.totals.S1_S2_MARKET.counted, all.totals.SCOPE2_MARKET.counted)
    const an = (await s.reviewer.get('/api/analytics')).body
    assert.equal(an.selected.periodId, s.period.id)
    near(an.selected.byFacility.find((f: { name: string }) => f.name === 'Plant B').counted.SCOPE2_LOCATION, 284) // 710 x 40%
    const months = an.selected.monthly.reduce((t: number, m: { lines: Record<string, string> }) => t + Number(m.lines.SCOPE2_LOCATION ?? 0), 0)
    near(months, 1586.54320261, 0.0001) // spreading over months keeps the total
    assert.equal((await s.entry.get('/api/analytics')).status, 403)
    const one = (await s.reviewer.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}&facilityId=${b.id}`)).body
    assert.equal(one.totals.SCOPE2_LOCATION.gross, '710')

    const csv = await s.reviewer.raw(`/api/reports/emissions?reportingPeriodId=${s.period.id}&format=csv`)
    assert.equal(csv.status, 200)
    assert.match(csv.headers.get('content-disposition')!, /provisional\.csv/)
    const text = await csv.text()
    assert.match(text, /PROVISIONAL/)
    assert.match(text, /Scope 2 electricity, location-based",1587,1161/) // R-06: 0 dp above 1,000 t
    assert.match(text, /Plant A,SCOPE2_LOCATION,876\.54,100/) // R-05: 2 dp per facility
    assert.match(text, /876\.543,876\.54320261/) // R-04: 3 dp per record, plus the stored value
    assert.match(text, /may not add up visibly/)
    assert.ok(await db.auditLog.findFirst({ where: { action: 'report.exported', entityId: s.period.id } }))
    assert.equal((await s.entry.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}`)).status, 403) // data entry: no reports
  })
})

describe('data checks V-05, V-07, V-20 and the GWP set', () => {
  test('V-07 refuses a second submission over the same days; V-05 flags a jump; V-20 lists missing months', async () => {
    const s = await setup('Checks Org')
    const day = (from: string, to: string, q: string) => ({ ...s.rec(s.grid.id, q, 'MWh'), startDate: from, endDate: to })
    for (const [from, to] of [['2024-04-01', '2024-04-30'], ['2024-05-01', '2024-05-31']]) await s.reviewer.post(`/api/activities/${await s.submit(day(from, to, '100'))}/approve`)
    const dup = await s.entry.post('/api/activities', day('2024-05-15', '2024-05-20', '10'))
    const r = await s.entry.post(`/api/activities/${dup.body.id}/submit`)
    assert.equal(r.status, 409)
    assert.match(r.body.error, /overlaps one already submitted/)
    const jump = await s.submit(day('2024-08-01', '2024-08-31', '300')) // about 3x the per-day mean (195% above), and June/July missing
    const preview = (await s.reviewer.get(`/api/activities/${jump}`)).body.preview
    assert.ok(preview[0].issues.some((i: { code: string; message: string }) => i.code === 'V-05' && /195% above/.test(i.message)))
    const gaps = (await s.reviewer.get(`/api/reporting-periods/${s.period.id}/checklist`)).body.items.find((i: { key: string }) => i.key === 'gaps')
    assert.equal(gaps.ok, false)
    assert.equal(gaps.mandatory, false)
    assert.match(gaps.detail, /2024-06, 2024-07/)
  })

  test('AR5 runs need a reason, use the AR5 values, and say so on the run and the report', async () => {
    const s = await setup('AR5 Org')
    await s.reviewer.post(`/api/activities/${await s.submit(s.rec(s.gas.id, '12', 'kg'))}/approve`) // R-410A
    assert.equal((await s.reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id, gwpSet: 'AR5' })).status, 400)
    const run = (await s.reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id, gwpSet: 'AR5', gwpReason: 'Scheme requires AR5 values' })).body
    assert.equal(run.gwpSet, 'AR5')
    assert.equal(dec(run.totals.SCOPE1.gross).toString(), '23.082') // 12 kg x 1923.5 (AR5 value in the EF-0289 note)
    const rep = (await s.reviewer.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}`)).body
    assert.equal(rep.gwpSet, 'AR5')
    assert.ok(rep.factors.some((f: { code: string }) => f.code === 'EF-0289-AR5'))
  })
})

describe('verifier portal', () => {
  test('a verifier sees only granted periods and approved records, read-only; queries are tracked and audited', async () => {
    const s = await setup('Verify Org')
    const otherPeriod = await db.reportingPeriod.create({ data: { organizationId: s.org.id, name: 'FY2023-24', startDate: new Date('2023-04-01'), endDate: new Date('2024-03-31') } })
    const approvedId = await s.submit(s.rec(s.grid.id, '100', 'MWh'))
    await s.reviewer.post(`/api/activities/${approvedId}/approve`)
    const pendingId = await s.submit(s.rec(s.grid.id, '50', 'MWh'))
    await s.reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id })

    // Nothing before a grant.
    assert.deepEqual((await s.verifier.get('/api/reporting-periods')).body, [])
    assert.equal((await s.verifier.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}`)).status, 404)

    // Only Tenant Admins grant, only to verifiers of this organisation, once.
    const grant = { userId: s.verifier.user.id, reportingPeriodId: s.period.id }
    assert.equal((await s.reviewer.post('/api/verifier-grants', grant)).status, 403)
    assert.equal((await s.admin.post('/api/verifier-grants', { ...grant, userId: s.entry.user.id })).status, 400)
    assert.equal((await s.admin.post('/api/verifier-grants', grant)).status, 201)
    assert.equal((await s.admin.post('/api/verifier-grants', grant)).status, 409)

    assert.deepEqual((await s.verifier.get('/api/reporting-periods')).body.map((p: { id: string }) => p.id), [s.period.id])
    const list = (await s.verifier.get('/api/activities')).body
    assert.deepEqual(list.rows.map((r: { id: string }) => r.id), [approvedId]) // not the submitted one
    assert.equal((await s.verifier.get(`/api/activities/${pendingId}`)).status, 404)
    assert.equal((await s.verifier.get(`/api/activities?reportingPeriodId=${otherPeriod.id}`)).body.total, 0)
    // Trace: report → run → result → record.
    const rep = (await s.verifier.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}`)).body
    near(rep.totals.SCOPE2_LOCATION.gross, 71)
    const run = (await s.verifier.get(`/api/calculations/runs/${rep.run.id}`)).body
    assert.equal(run.results.rows[0].activityRecordId, approvedId)
    assert.equal((await s.verifier.get(`/api/activities/${approvedId}`)).status, 200)
    // Read-only, and no internal administration.
    assert.equal((await s.verifier.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).status, 403)
    assert.equal((await s.verifier.post(`/api/activities/${approvedId}/return`, { reason: 'nope nope' })).status, 403)
    assert.equal((await s.verifier.get('/api/verifier-grants')).status, 403)
    assert.equal((await s.verifier.get('/api/members')).status, 403)

    // Queries: verifier raises, organisation answers, verifier closes.
    assert.equal((await s.verifier.post('/api/queries', { reportingPeriodId: otherPeriod.id, subject: 'Hello', message: 'Not granted' })).status, 404)
    assert.equal((await s.verifier.post('/api/queries', { reportingPeriodId: s.period.id, activityRecordId: pendingId, subject: 'Why?', message: 'Unapproved record' })).status, 400)
    assert.equal((await s.reviewer.post('/api/queries', { reportingPeriodId: s.period.id, subject: 'x', message: 'Only verifiers raise' })).status, 403)
    const q = await s.verifier.post('/api/queries', { reportingPeriodId: s.period.id, activityRecordId: approvedId, subject: 'Invoice for April', message: 'Please share the DISCOM invoice for April.' })
    assert.equal(q.status, 201)
    assert.equal((await s.reviewer.post(`/api/queries/${q.body.id}/messages`, { body: 'Attached to the record as evidence.' })).status, 201)
    assert.equal((await s.verifier.get(`/api/queries/${q.body.id}`)).body.status, 'ANSWERED')
    assert.equal((await s.entry.post(`/api/queries/${q.body.id}/close`)).status, 403)
    assert.equal((await s.verifier.post(`/api/queries/${q.body.id}/close`)).body.status, 'CLOSED')
    assert.equal((await s.reviewer.post(`/api/queries/${q.body.id}/messages`, { body: 'One more thing' })).status, 409)
    const thread = (await s.admin.get(`/api/queries/${q.body.id}`)).body
    assert.equal(thread.messages.length, 2)
    assert.equal((await s.admin.get(`/api/queries?status=CLOSED`)).body.total, 1)

    const audited = (await db.auditLog.findMany({ where: { organizationId: s.org.id, actorUserId: s.verifier.user.id } })).map((a) => a.action)
    for (const a of ['verifier.report_viewed', 'verifier.record_viewed', 'verification.query_raised', 'verification.query_closed']) assert.ok(audited.includes(a), a)

    // Revoking the grant removes access at once; the query history stays.
    const grantId = (await s.admin.get('/api/verifier-grants')).body[0].id
    assert.equal((await s.admin.del(`/api/verifier-grants/${grantId}`)).status, 204)
    assert.equal((await s.verifier.get(`/api/activities/${approvedId}`)).status, 404)
    assert.equal((await s.verifier.get(`/api/queries/${q.body.id}`)).status, 404)
    assert.equal((await s.admin.get(`/api/queries/${q.body.id}`)).status, 200)

    // A verifier of another organisation sees none of it.
    const foreign = await signInAs(base, (await makeOrg('Foreign Verify Org')).id, 'VERIFIER')
    assert.equal((await foreign.get(`/api/queries/${q.body.id}`)).status, 404)
    assert.equal((await foreign.get(`/api/reports/emissions?reportingPeriodId=${s.period.id}`)).status, 404)
  })
})

describe('own values need a source, a document and a second person', () => {
  test('source enforced at submit; evidence before approval; no self-confirmation; the result names the own factor', async () => {
    const s = await setup('Own Values Org')
    const own = { co2Factor: '7400', density: '0.84', densityUnit: 'kg/l' }
    const bare = await s.entry.post('/api/activities', s.rec(s.diesel.id, '1000', 'l', own))
    const refused = await s.entry.post(`/api/activities/${bare.body.id}/submit`)
    assert.equal(refused.status, 400)
    assert.match(refused.body.error, /source of your own CO2 factor/)

    // Entered by the Tenant Admin, so the admin may approve it but not confirm its warnings.
    const created = await s.admin.post('/api/activities', s.rec(s.diesel.id, '1000', 'l', { ...own, co2FactorSource: 'Lab report 42' }))
    assert.equal((await s.admin.post(`/api/activities/${created.body.id}/submit`)).status, 200)
    const noDoc = await s.admin.post(`/api/activities/${created.body.id}/approve`)
    assert.equal(noDoc.status, 409)
    assert.match(noDoc.body.error, /Attach the analysis or certificate/)
    const user = await db.user.findFirstOrThrow()
    await db.evidence.create({ data: { organizationId: s.org.id, activityRecordId: created.body.id, fileName: 'lab.pdf', mimeType: 'application/pdf', sizeBytes: 1, sha256: 'x'.repeat(64), storageKey: 'none', uploadedById: user.id } })
    assert.equal((await s.admin.post(`/api/activities/${created.body.id}/approve`)).status, 200)

    assert.equal((await s.admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).status, 201)
    const result = await db.calculationResult.findFirstOrThrow({ where: { activityRecordId: created.body.id } })
    assert.equal((result.inputs as Record<string, unknown>).co2FactorUsed, '7400')
    assert.equal((result.inputs as Record<string, unknown>).carbonOrigin, 'Fossil')
    assert.ok(result.needsConfirmation) // far from the default
    const self = await s.admin.post(`/api/calculations/results/${result.id}/confirm`, { reason: 'checked' })
    assert.equal(self.status, 409)
    assert.match(self.body.error, /another person must confirm/)
    const ok = await s.reviewer.post(`/api/calculations/results/${result.id}/confirm`, { reason: 'Lab report 42 checked' })
    assert.equal(ok.status, 200, JSON.stringify(ok.body))
  })
})
