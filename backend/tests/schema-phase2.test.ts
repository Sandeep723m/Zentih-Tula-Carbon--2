// Phase 2 / P2-A foundation: the schema rules the later stages rely on, and the GHG category mapping.
import assert from 'node:assert/strict'
import { describe, test } from 'node:test'
import { getPrisma } from '../src/config/database.js'
import { ACTIVITY_TYPES, ghgCategoryOf } from '../src/calc/referenceData.js'
import { makeOrg, makeSite, makeUser } from './helpers.js'

const db = getPrisma()
const mysql = (process.env.DATABASE_URL ?? '').startsWith('mysql:')

async function facilityWithUser(orgName: string) {
  const user = await makeUser()
  const org = await makeOrg(orgName, [[user.id, 'TENANT_ADMIN']])
  const facility = await db.facility.create({ data: { organizationId: org.id, name: 'Plant', code: 'PLANT-1' } })
  return { user, org, facility }
}

describe('P2-A schema', () => {
  test('new organisations start with assignment enforcement and grid-from-snapshot off', async () => {
    const org = await makeOrg('P2A Defaults Org')
    assert.equal(org.assignmentsEnforced, false)
    assert.equal(org.gridFromSnapshot, false)
    const facility = await db.facility.create({ data: { organizationId: org.id, name: 'Unplaced', code: 'UNPLACED' } })
    assert.equal(facility.siteId, null) // a facility may exist without a site
  })

  test('site codes are unique within an organisation, not across organisations', async () => {
    const a = await makeOrg('P2A Site Org A')
    const b = await makeOrg('P2A Site Org B')
    await makeSite(a.id, 'HYD')
    await assert.rejects(makeSite(a.id, 'HYD'))
    await makeSite(b.id, 'HYD')
  })

  test('T6: a facility has at most one open placement; closed placements are unlimited', async () => {
    const { user, org, facility } = await facilityWithUser('P2A Placement Org')
    const hyd = await makeSite(org.id, 'HYD')
    const blr = await makeSite(org.id, 'BLR')
    const row = (siteId: string, validFrom: string, validTo: string | null) => ({
      organizationId: org.id, facilityId: facility.id, siteId, validFrom: new Date(validFrom),
      validTo: validTo ? new Date(validTo) : null, openKey: validTo ? null : facility.id, reason: 'test', createdById: user.id,
    })
    await db.facilitySiteHistory.create({ data: row(hyd.id, '2025-01-01', '2025-12-31') })
    await db.facilitySiteHistory.create({ data: row(blr.id, '2026-01-01', '2026-01-31') })
    await db.facilitySiteHistory.create({ data: row(hyd.id, '2026-02-01', null) })
    await assert.rejects(db.facilitySiteHistory.create({ data: row(blr.id, '2026-03-01', null) }), /Unique constraint/)
    assert.equal(await db.facilitySiteHistory.count({ where: { facilityId: facility.id } }), 3)
  })

  test('a placement cannot end before it starts', { skip: mysql && 'CHECK constraint is added by the PostgreSQL migration only' }, async () => {
    const { user, org, facility } = await facilityWithUser('P2A Range Org')
    const site = await makeSite(org.id, 'RNG')
    await assert.rejects(db.facilitySiteHistory.create({ data: {
      organizationId: org.id, facilityId: facility.id, siteId: site.id, validFrom: new Date('2026-02-01'),
      validTo: new Date('2026-01-31'), reason: 'test', createdById: user.id,
    } }))
  })

  test('results written without a site attribution read as LEGACY_UNKNOWN', { skip: mysql && 'checked on PostgreSQL' }, async () => {
    const [col] = await db.$queryRawUnsafe<Array<{ column_default: string; is_nullable: string }>>(
      `SELECT column_default, is_nullable FROM information_schema.columns
       WHERE table_schema = 'test' AND table_name = 'CalculationResult' AND column_name = 'siteAttribution'`)
    assert.equal(col.is_nullable, 'NO')
    assert.match(col.column_default, /LEGACY_UNKNOWN/)
  })
})

describe('ghgCategoryOf', () => {
  const expected: Record<string, string> = {
    'Stationary combustion': 'S1_STATIONARY', 'Mobile combustion': 'S1_MOBILE', Fugitive: 'S1_FUGITIVE',
    Process: 'S1_PROCESS', 'Purchased electricity': 'S2_ELECTRICITY',
    'Purchased steam / heat / cooling': 'S2_HEAT_STEAM_COOLING', 'Removal / recovery': 'REMOVALS',
  }

  test('every selectable activity type maps to exactly its GHG category', () => {
    const selectable = ACTIVITY_TYPES.filter((a) => a.sourceCategory)
    assert.ok(selectable.length > 0)
    for (const a of selectable) assert.equal(ghgCategoryOf(a.sourceCategory!, a.category), expected[a.category], a.code)
    // Not selectable (A-PPA instrument, agriculture): no source category, so never mapped.
    for (const a of ACTIVITY_TYPES.filter((x) => !x.sourceCategory)) assert.ok(a.code === 'A-PPA' || a.category === 'Process', a.code)
  })

  test('fuel combustion without an activity type is ambiguous and is not guessed', () => {
    assert.equal(ghgCategoryOf('FUEL_COMBUSTION', null), null)
    assert.equal(ghgCategoryOf('FUEL_COMBUSTION'), null)
  })

  test('other source categories map without an activity type', () => {
    assert.equal(ghgCategoryOf('FUGITIVE_GAS'), 'S1_FUGITIVE')
    assert.equal(ghgCategoryOf('PROCESS'), 'S1_PROCESS')
    assert.equal(ghgCategoryOf('PURCHASED_ELECTRICITY'), 'S2_ELECTRICITY')
    assert.equal(ghgCategoryOf('PURCHASED_ENERGY'), 'S2_HEAT_STEAM_COOLING')
    assert.equal(ghgCategoryOf('REMOVAL'), 'REMOVALS')
  })

  test('an activity that does not fit its source category is not classified', () => {
    assert.equal(ghgCategoryOf('FUGITIVE_GAS', 'Stationary combustion'), null)
    assert.equal(ghgCategoryOf('FUEL_COMBUSTION', 'Fugitive'), null)
    assert.equal(ghgCategoryOf('REMOVAL', 'Purchased electricity'), null)
  })

  test('removals never map into Scope 1 or 2', () => {
    for (const a of ACTIVITY_TYPES.filter((x) => x.sourceCategory === 'REMOVAL')) assert.equal(ghgCategoryOf('REMOVAL', a.category), 'REMOVALS')
  })
})
