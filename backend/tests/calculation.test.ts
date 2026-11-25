import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { dec } from '../src/calc/core/decimal.js'
import type { FactorRow, Reference } from '../src/calc/core/types.js'
import { toCO2eTonnes } from '../src/calc/core/factors.js'
import { calculate, methodByCode, methodsFor, resolveActivity } from '../src/calc/registry.js'
import { ACTIVITY_TYPES, GRID_REGIONS, SEED_FACTORS, UNITS } from '../src/calc/referenceData.js'
import { getPrisma } from '../src/config/database.js'
import { makeOrg, signInAs, signInSuperAdmin, startServer } from './helpers.js'
import { WORKED_EXAMPLES } from './workbook-examples.js'

// ---- Engine against the workbook (tab 07 worked examples; tolerance per R-12) -------------------

type Seed = (typeof SEED_FACTORS)[number]
type FactorInput = { [K in keyof Seed]?: string | null } & { code: string; value: string; validFrom: string }
const factorRow = (f: FactorInput, createdAt = new Date('2026-01-01')): FactorRow => {
  const base = { ...SEED_FACTORS.find((x) => x.code === 'EF-0020')! } as Record<string, string | null | undefined>
  const r = { ...base, ...f } as Record<keyof Seed, string | null | undefined> & FactorInput
  return {
    id: r.id ?? `seed-${r.code}`, code: r.code, activityCode: r.activityCode ?? null, gas: r.gas!, value: r.value, numeratorUnit: r.numeratorUnit!,
    denominatorUnit: r.denominatorUnit!, carbonOrigin: r.carbonOrigin!, source: r.source!, sourceVersion: r.sourceVersion!, tier: r.tier!,
    validFrom: new Date(r.validFrom), validTo: r.validTo ? new Date(r.validTo) : null, regionCode: r.regionCode ?? null, createdAt,
    gwpSet: r.gwpSet ?? null, status: 'APPROVED', organizationId: null,
  }
}
const FACTORS = SEED_FACTORS.map((f) => factorRow(f))
const ref = (activityCodes: string[] = ['A-GRID'], extra: FactorRow[] = []): Reference => ({
  units: UNITS.map(([code, , dimension, , toBase]) => ({ code, dimension, toBase })),
  regions: GRID_REGIONS.map(([code, name, , fallbackCode]) => ({ code, name, fallbackCode })),
  factors: [...FACTORS, ...extra],
  activityTypes: ACTIVITY_TYPES.filter((a) => activityCodes.includes(a.code)),
  gwpSet: 'AR6',
})
const FY2425 = new Date('2024-04-01')
const run = (quantity: string, unit: string, gridLocation: string | null = 'India - National Average', periodStart = FY2425, extra: FactorRow[] = []) =>
  calculate({ quantity, unit, gridLocation, periodStart, parameters: {} }, ref(['A-GRID'], extra), 'C-06')
const fuel = (activityCode: string, quantity: string, unit: string, parameters: Record<string, unknown> = {}, formulaCode = ACTIVITY_TYPES.find((a) => a.code === activityCode)!.formulaCode!) =>
  calculate({ quantity, unit, gridLocation: null, periodStart: FY2425, parameters }, ref([activityCode]), formulaCode)
const near = (actual: unknown, expected: number, tolerance: number) =>
  assert.ok(Math.abs(Number(String(actual)) - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)

describe('workbook tab 07 worked examples', () => {
  for (const ex of WORKED_EXAMPLES) {
    test(`${ex.id} (${ex.formulaCode}): ${ex.proves} → ${ex.expected} ${ex.unit} ± ${ex.tolerance}`, () => {
      assert.ok(methodByCode(ex.formulaCode), `no method registered for ${ex.formulaCode}`)
      const o = calculate({ ...ex.input, gridLocation: ex.input.gridLocation ?? null, periodStart: new Date(ex.input.periodStart), parameters: ex.input.parameters ?? {} }, ref([ex.activityCode]), ex.formulaCode)
      assert.equal(o.formulaCode, ex.formulaCode)
      assert.equal(o.status, 'CALCULATED', JSON.stringify(o.issues))
      if (ex.factorCode) assert.equal(o.factor?.code, ex.factorCode)
      near(ex.unit === 'tCO2 (biogenic)' ? o.biogenicTCO2 : o.tCO2e, ex.expected, ex.tolerance)
    })
  }
})

describe('every formula an activity type names resolves to the methods the registry runs', () => {
  test('electricity runs C-06 and C-07 side by side; fuels and gases one method each', () => {
    assert.deepEqual(methodsFor('C-06').map((m) => m.formulaCode), ['C-06', 'C-07'])
    for (const code of ['C-01', 'C-02', 'C-03', 'C-05']) assert.equal(methodsFor(code).length, 1)
    for (const code of ['C-04', 'C-08', 'C-21']) assert.equal(methodsFor(code).length, 1)
    const count = (code: string) => ACTIVITY_TYPES.filter((a) => a.formulaCode === code).length
    assert.ok(count('C-01') > 20 && count('C-05') >= 14)
  })

  test('a source with no fuel chosen blocks (SRC-01) instead of guessing one', () => {
    const types = ACTIVITY_TYPES.map((a) => ({ ...a }))
    const r = resolveActivity({ category: 'FUEL_COMBUSTION', activityCode: null }, types)
    assert.equal(r?.types.length, 0)
    const o = calculate({ quantity: '1', unit: 't', gridLocation: null, periodStart: FY2425, parameters: {} }, { ...ref([]), activityTypes: [] }, r!.formulaCode)
    assert.ok(o)
    assert.deepEqual(o.issues.map((i) => i.code), ['SRC-01'])
    assert.equal(resolveActivity({ category: 'PURCHASED_ELECTRICITY', activityCode: null }, types)?.formulaCode, 'C-06') // legacy grid sources
    assert.equal(resolveActivity({ category: 'PURCHASED_ENERGY', activityCode: null }, types)?.formulaCode, 'C-21')
    assert.equal(ACTIVITY_TYPES.find((a) => a.code === 'A-PR-ENTERIC-FERME')?.formulaCode, null) // agriculture: Phase 2 (S-17)
  })
})

describe('C-01 to C-03 fuel combustion rules', () => {
  test('per-gas masses kept unrounded (R-03), biogenic CO2 outside the total (C-02)', () => {
    const o = fuel('A-ST-WOOD-WOOD-WASTE', '200', 't')
    assert.equal(o.gases?.CO2, '349440')
    assert.equal(o.biogenicTCO2?.toString(), '349.44')
    assert.equal(o.tCO2e?.toString(), '5.93424') // 93.6 kg CH4 x 27.0 (non-fossil) + 12.48 kg N2O x 273
  })

  test('V-09: a volume entry uses the certificate density, else the workbook default with a confirmation, else blocks; C-14: an energy entry must state its basis', () => {
    // V-09 blocks only when no density is available "(user or default)". Diesel has a workbook default (0.84 kg/l).
    const def = fuel('A-ST-DIESEL-GAS-OIL', '1000', 'l')
    assert.deepEqual(def.issues.map((i) => i.code), ['J-04', 'R-03'])
    assert.equal(def.needsConfirmation, true)
    assert.equal(def.inputs.densityUsed, '0.84')
    assert.equal(def.inputs.massTonnes, '0.84')
    assert.equal(fuel('A-ST-DIESEL-GAS-OIL', '1000', 'l', { density: '0.84', densityUnit: 'kg/l' }).tCO2e?.toString(), def.tCO2e?.toString())
    assert.deepEqual(fuel('A-ST-ORIMULSIO', '1000', 'l').issues.map((i) => i.code), ['V-09']) // no default density in the workbook
    // Stationary LPG is measured in SCM, but its workbook density (0.54 kg/l) is the liquid's: never applied to a gas volume.
    const lpg = fuel('A-ST-LPG', '1000', 'SCM')
    assert.equal(lpg.issues[0].code, 'V-09')
    assert.match(lpg.issues[0].message, /for the liquid, not a gas volume/)
    assert.deepEqual(fuel('A-ST-NATURAL-GAS', '1000', 'kWh').issues.map((i) => i.code), ['C-14'])
    assert.equal(fuel('A-ST-NATURAL-GAS', '1000', 'kWh', { energyBasis: 'GCV' }).issues[0].code, 'V-06') // warn, then calculated
  })

  test('V-16: units outside the fuel list (litres of coal, km for stationary fuel) are blocked', () => {
    assert.equal(fuel('A-COAL', '10', 'l').issues[0].code, 'V-16')
    assert.equal(fuel('A-ST-DIESEL-GAS-OIL', '10', 'km').issues[0].code, 'V-16')
  })

  test('rule 3: IPCC Tier 1 defaults need a confirmation; rule 5 / V-10 / V-14: own NCV is range-checked', () => {
    const def = fuel('A-COAL', '1250', 't')
    assert.deepEqual(def.issues.map((i) => i.code), ['R-03'])
    assert.equal(def.needsConfirmation, true)
    assert.deepEqual(fuel('A-COAL', '1250', 't', { ncv: '0.0196' }).issues.map((i) => i.code), ['V-10', 'R-05', 'R-03']) // 24% below default
    assert.ok(fuel('A-COAL', '1250', 't', { ncv: '258' }).issues.some((i) => i.code === 'V-14')) // GJ/t typed as TJ/t
  })

  test('V-03: a fuel whose workbook rows lack CH4/N2O factors is blocked, never estimated', () => {
    assert.equal(fuel('A-BIOM', '10', 't').issues[0].code, 'V-03')
  })
})

describe('C-09, C-04, C-08, C-21 rules', () => {
  test('WE-18: 1,000 kg CO2 + 100 kg fossil CH4 + 10 kg N2O = 6,710 kg CO2e (AR6) or 6,450 kg (AR5)', () => {
    const gwp = (set: 'AR6' | 'AR5', gas: string) => FACTORS.find((f) => f.activityCode === null && f.gas === gas && f.carbonOrigin === 'Fossil' && f.gwpSet === set)!.value
    const kg = { CO2: dec(1000), CH4: dec(100), N2O: dec(10) }
    assert.equal(toCO2eTonnes(kg, { CH4: gwp('AR6', 'CH4'), N2O: gwp('AR6', 'N2O') }).mul(1000).toString(), '6710')
    assert.equal(toCO2eTonnes(kg, { CH4: gwp('AR5', 'CH4'), N2O: gwp('AR5', 'N2O') }).mul(1000).toString(), '6450')
  })

  test('AR5 for biomass is blocked: the workbook gives no AR5 non-fossil CH4', () => {
    const o = calculate({ quantity: '200', unit: 't', gridLocation: null, periodStart: FY2425, parameters: {} }, { ...ref(['A-ST-WOOD-WOOD-WASTE']), gwpSet: 'AR5' }, 'C-02')
    assert.equal(o.issues.at(-1)?.code, 'V-03')
  })

  test('C-04: several factors need a choice; nitric acid N2O goes through GWP; wastewater needs an MCF; landfill blocks (Q-06)', () => {
    assert.equal(fuel('A-PR-LIME-PRODU', '1000', 't').issues[0].code, 'C-04') // high-calcium or dolomitic?
    assert.equal(fuel('A-PR-NITRIC-ACID-PRODU', '1000', 't', { factorCode: 'EF-0319' }).tCO2e?.toString(), '1365') // 5,000 kg N2O x 273
    assert.equal(fuel('A-PR-CEMENT-CLINK-PRODU', '100000', 't', { abatedFraction: '0.1' }).tCO2e?.toString(), '46800')
    assert.equal(fuel('A-PR-WASTEWATE-TREAT', '1000', 'kg BOD', { factorCode: 'EF-0322' }).issues[0].code, 'C-04')
    assert.equal(fuel('A-PR-WASTEWATE-TREAT', '1000', 'kg BOD', { factorCode: 'EF-0322', mcf: '0.5' }).tCO2e?.toString(), '8.94') // 300 kg CH4 x 29.8
    assert.equal(fuel('A-PR-WASTEWATE-TREAT', '1000', 'kg N', { factorCode: 'EF-0323' }).gases?.N2O, String(dec(5).mul(44).div(28))) // N2O-N x 44/28
    assert.equal(fuel('A-PR-SOLID-WASTE-DISPO', '10', 't').issues[0].code, 'V-03')
  })

  test('C-21 blocks without a supplier factor (V-19); cooling ton-hours convert to GJ', () => {
    assert.equal(fuel('A-STEAM', '8000', 'GJ').issues[0].code, 'V-19')
    assert.equal(fuel('A-COOL', '100000', 'ton-hour', { supplierFactor: '100' }).tCO2e?.toString(), '126.6067') // 1,266.067 GJ x 100 / 1000
  })

  test('C-08 warns without a meter reference (V-08) and always asks for the end-use judgement (J-05)', () => {
    assert.deepEqual(fuel('A-CO2-REC', '500', 't').issues.map((i) => i.code), ['V-08', 'J-05'])
  })
})

describe('C-05 fugitive rules', () => {
  test('V-15: recovered above disposed is blocked; screening needs a leak rate and a confirmation (J-07)', () => {
    assert.equal(fuel('A-FU-SF6', '0', 'kg', { disposedKg: '18', recoveredKg: '20' }).issues[0].code, 'V-15')
    assert.equal(fuel('A-FU-R-134A', '50', 'kg', { method: 'SCREENING' }).issues[0].code, 'C-17')
    assert.equal(fuel('A-FU-R-134A', '50', 'kg', { method: 'SCREENING', leakRate: '0.1' }).needsConfirmation, true)
  })

  test('generic refrigerant without a GWP is blocked (EF-0030 is blank in the workbook)', () => {
    assert.equal(fuel('A-REFR', '5', 'kg').issues[0].code, 'V-03')
  })
})

describe('C-07 Scope 2 market-based rules', () => {
  const mkt = (params: Record<string, unknown>, quantity = '500', unit = 'MWh', periodStart = FY2425) =>
    calculate({ quantity, unit, gridLocation: 'India - National Average', periodStart, parameters: params }, ref(['A-GRID']), 'C-07')

  test('no instruments: all MWh at the grid average, disclosed (Q-02) and confirmed', () => {
    const o = mkt({})
    assert.equal(o.tCO2e?.toString(), '355')
    assert.deepEqual(o.issues.map((i) => i.code), ['Q-02'])
    assert.equal(o.needsConfirmation, true)
  })

  test('V-13: instrument MWh above consumption is blocked; instruments need a type and reference', () => {
    assert.equal(mkt({ instrumentMWh: '501', instrumentType: 'I-REC', instrumentReference: 'X' }).issues[0].code, 'V-13')
    assert.equal(mkt({ instrumentMWh: '100' }).issues[0].code, 'C-07')
  })

  test('V-03: no instrument factor outside FY2024-25 (EF-0340 is valid that year only)', () => {
    const o = mkt({ instrumentMWh: '100', instrumentType: 'PPA', instrumentReference: 'PPA-1' }, '500', 'MWh', new Date('2023-04-01'))
    assert.equal(o.issues.at(-1)?.code, 'V-03')
  })
})

describe('C-06 Scope 2 location-based (workbook TC-DOM-002a)', () => {
  test('WE-14: 1,200,000 kWh, FY2024-25, all-India, EF-0020 0.710 → 852.0 tCO2e (± 0.01)', () => {
    const o = run('1200000', 'kWh')
    assert.equal(o.status, 'CALCULATED')
    assert.equal(o.factor?.code, 'EF-0020')
    near(o.tCO2e, 852.0, 0.01)
    assert.equal(o.tCO2e?.toString(), '852') // exact decimal arithmetic: no float drift
    assert.equal(o.inputs.convertedQuantity, '1200')
    assert.equal(o.inputs.conversionFactor, '0.001') // C-06: MWh = kWh x 0.001
    assert.equal(o.issues.length, 0)
    assert.equal(o.needsConfirmation, false)
  })

  test('unit conversion: MWh and GJ reach the same MWh (GJ / 3.6), lowercase unit accepted', () => {
    assert.equal(run('1200', 'MWh').tCO2e?.toString(), '852')
    assert.equal(run('4320', 'GJ').tCO2e?.toString(), '852') // 4,320 GJ / 3.6 = 1,200 MWh
    const lower = run('1200000', 'kwh')
    assert.equal(lower.tCO2e?.toString(), '852')
    assert.equal(lower.inputs.unit, 'kWh')
    assert.equal(lower.inputs.unitEntered, 'kwh') // R-01: what was entered is kept
  })

  test('full precision is kept (R-02, R-04): 1,234,567.891 kWh x 0.710', () => {
    assert.equal(run('1234567.891', 'kWh').tCO2e?.toString(), '876.54320261')
  })

  test('rule 4 / V-04: a FY2023-24 period uses the version frozen for that year (EF-0338 0.727), and warns that a newer one exists', () => {
    const o = run('1200000', 'kWh', 'India - National Average', new Date('2023-04-01'))
    assert.equal(o.factor?.code, 'EF-0338')
    near(o.tCO2e, 872.4, 0.01)
    assert.deepEqual(o.issues.map((i) => i.code), ['V-04'])
    assert.equal(o.needsConfirmation, true)
  })

  test('rule 9: a regional grid without its own factor falls back to all-India, flagged for confirmation', () => {
    const o = run('1200000', 'kWh', 'India - Southern Grid')
    assert.equal(o.status, 'CALCULATED')
    assert.equal(o.factor?.code, 'EF-0020')
    near(o.tCO2e, 852.0, 0.01)
    assert.equal(o.inputs.regionAsked, 'IN-S')
    assert.equal(o.inputs.regionUsed, 'IN-ALL')
    assert.deepEqual(o.issues.map((i) => i.code), ['R-09'])
    assert.equal(o.needsConfirmation, true)
    assert.equal((o.selection as { fallback: boolean }).fallback, true)
  })

  test('a regional factor, once loaded, wins over the fallback', () => {
    const southern = factorRow({ id: 'S', code: 'EF-S', value: '0.8', validFrom: '2024-04-01', regionCode: 'IN-S' })
    const o = run('1200', 'MWh', 'India - Southern Grid', FY2425, [southern])
    assert.equal(o.factor?.code, 'EF-S')
    assert.equal(o.tCO2e?.toString(), '960')
    assert.equal(o.issues.length, 0)
  })

  test('V-18: no grid region, an unknown one, or one with no factor loaded is blocked', () => {
    for (const grid of [null, 'Atlantis Grid', 'UK - DEFRA']) {
      const o = run('1000', 'kWh', grid)
      assert.equal(o.status, 'BLOCKED', String(grid))
      assert.equal(o.tCO2e, null)
      assert.deepEqual(o.issues.map((i) => i.code), ['V-18'], String(grid))
    }
  })

  test('V-03: no factor valid on the period start (FY2025-26 has none in the workbook) is blocked, never guessed', () => {
    const o = run('1000', 'kWh', 'India - National Average', new Date('2025-04-01'))
    assert.equal(o.status, 'BLOCKED')
    assert.deepEqual(o.issues.map((i) => i.code), ['V-03'])
    assert.equal(run('1000', 'kWh', 'India - Southern Grid', new Date('2022-04-01')).issues[0].code, 'V-03')
  })

  test('V-01 / V-16: unknown unit, or a unit not allowed for electricity, is blocked', () => {
    assert.equal(run('1000', 'furlong').issues[0].code, 'V-01')
    assert.equal(run('1000', '').issues[0].code, 'V-01')
    assert.equal(run('1000', 'l').issues[0].code, 'V-16')
    assert.equal(run('1000', 'MMBtu').issues[0].code, 'V-16')
  })

  test('rule 14: two factors valid for the period → the most recently published is used, the other recorded and flagged', () => {
    const later = factorRow({ id: 'L', code: 'EF-LATER', value: '0.72', validFrom: '2024-04-01' }, new Date('2026-06-01'))
    const o = run('1000', 'MWh', 'India - National Average', FY2425, [later])
    assert.equal(o.factor?.code, 'EF-LATER')
    assert.deepEqual(o.issues.map((i) => i.code), ['R-14'])
    assert.deepEqual((o.selection as { otherCandidates: string[] }).otherCandidates, ['EF-0020'])
  })

  test('a factor published in kgCO2e/MWh gives the same tonnes', () => {
    const kg = factorRow({ id: 'K', code: 'EF-KG', value: '710', validFrom: '2024-04-01', numeratorUnit: 'kgCO2e', regionCode: 'IN-N' })
    assert.equal(run('1200', 'MWh', 'India - Northern Grid', FY2425, [kg]).tCO2e?.toString(), '852')
  })
})

// ---- API: data entry → run → persisted, traceable results ---------------------------------------

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
type Client = Awaited<ReturnType<typeof signInSuperAdmin>>
let sa: Client

before(async () => { sa = await signInSuperAdmin(base) })

async function setupOrg(name: string) {
  const org = await makeOrg(name)
  const [a, b] = await Promise.all([
    db.facility.create({ data: { organizationId: org.id, name: 'Plant A', code: 'PA', country: 'India', gridLocation: 'India - National Average' } }),
    db.facility.create({ data: { organizationId: org.id, name: 'Plant B', code: 'PB', country: 'India', gridLocation: 'India - Southern Grid' } }),
  ])
  const period = await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'FY2024-25', startDate: new Date('2024-04-01'), endDate: new Date('2025-03-31') } })
  const [elA, elB, fuel] = await Promise.all([
    db.emissionSource.create({ data: { organizationId: org.id, facilityId: a.id, name: 'Grid supply', category: 'PURCHASED_ELECTRICITY', defaultUnit: 'kWh' } }),
    db.emissionSource.create({ data: { organizationId: org.id, facilityId: b.id, name: 'Grid supply', category: 'PURCHASED_ELECTRICITY', defaultUnit: 'MWh' } }),
    db.emissionSource.create({ data: { organizationId: org.id, facilityId: a.id, name: 'DG set', category: 'FUEL_COMBUSTION', material: 'Diesel', defaultUnit: 'l' } }),
  ])
  return { org, a, b, period, elA, elB, fuel }
}

// Each record gets its own day: one source cannot have two submitted records over the same days (V-07).
let nextDay = 0
const uniqueDay = () => new Date(Date.UTC(2024, 3, 1) + (nextDay++ % 365) * 86_400_000).toISOString().slice(0, 10)
const record = (s: Awaited<ReturnType<typeof setupOrg>>, facilityId: string, emissionSourceId: string, quantity: string, unit: string) => {
  const day = uniqueDay()
  return { facilityId, reportingPeriodId: s.period.id, emissionSourceId, startDate: day, endDate: day, quantity, unit }
}

// Entered and submitted by data entry, approved by a reviewer: only approved records are calculated.
async function approved(s: { org: { id: string } }, c: Client, body: unknown) {
  const r = await c.post('/api/activities', body)
  assert.equal(r.status, 201, JSON.stringify(r.body))
  assert.equal((await c.post(`/api/activities/${r.body.id}/submit`)).status, 200)
  approvers[s.org.id] ??= await signInAs(base, s.org.id, 'REVIEWER')
  const a = await approvers[s.org.id].post(`/api/activities/${r.body.id}/approve`)
  assert.equal(a.status, 200, JSON.stringify(a.body))
  return r.body.id as string
}
const approvers: Record<string, Client> = {}

describe('calculation runs', () => {
  test('electricity records only accept kWh, MWh or GJ (V-16 at entry)', async () => {
    const s = await setupOrg('Calc Units Org')
    const entry = await signInAs(base, s.org.id, 'DATA_ENTRY')
    const bad = await entry.post('/api/activities', record(s, s.a.id, s.elA.id, '100', 'litre'))
    assert.equal(bad.status, 400)
    assert.match(bad.body.error, /kWh, MWh, GJ/)
    assert.equal((await entry.post('/api/activities', record(s, s.a.id, s.elA.id, '100', 'MWh'))).status, 201)
    assert.equal((await entry.post('/api/activities', record(s, s.a.id, s.fuel.id, '100', 'litre'))).status, 400) // fuels: tab 03 codes only
    assert.equal((await entry.post('/api/activities', record(s, s.a.id, s.fuel.id, '100', 'l'))).status, 201)
  })

  test('extra calculation inputs are only what the method declares', async () => {
    const s = await setupOrg('Calc Params Org')
    const entry = await signInAs(base, s.org.id, 'DATA_ENTRY')
    assert.equal((await entry.post('/api/activities', { ...record(s, s.a.id, s.elA.id, '100', 'MWh'), parameters: { density: 0.84 } })).status, 400) // C-06 takes none
    assert.equal((await entry.post('/api/activities', { ...record(s, s.a.id, s.fuel.id, '100', 'l'), parameters: { density: 0.84, densityUnit: 'kg/l' } })).status, 201) // C-01 inputs
    assert.equal((await entry.post('/api/activities', { ...record(s, s.a.id, s.fuel.id, '100', 'l'), parameters: { colour: 'red' } })).status, 400) // undeclared
    assert.equal((await entry.post('/api/activities', { ...record(s, s.a.id, s.elA.id, '100', 'MWh'), parameters: { instrumentMWh: '40', instrumentType: 'I-REC', instrumentReference: 'R1' } })).status, 201) // C-07 inputs
    assert.equal((await entry.post('/api/activities', record(s, s.a.id, s.elA.id, '0', 'MWh'))).status, 400) // zero only for refrigerant mass balance
    assert.equal((await entry.post('/api/activities', { ...record(s, s.a.id, s.elA.id, '100', 'MWh'), parameters: {} })).status, 201)
  })

  test('end to end: approved records are calculated, persisted, traced and summed; others are left out', async () => {
    const s = await setupOrg('Calc E2E Org')
    const entry = await signInAs(base, s.org.id, 'DATA_ENTRY')
    const reviewer = await signInAs(base, s.org.id, 'REVIEWER')
    const verifier = await signInAs(base, s.org.id, 'VERIFIER')
    const recA = await approved(s, entry, record(s, s.a.id, s.elA.id, '1200000', 'kWh'))
    await approved(s, entry, record(s, s.b.id, s.elB.id, '500', 'MWh'))
    await approved(s, entry, record(s, s.a.id, s.fuel.id, '1000', 'l')) // no fuel chosen on the source: blocked (SRC-01)
    assert.equal((await entry.post('/api/activities', record(s, s.a.id, s.elA.id, '999999', 'kWh'))).status, 201) // draft: excluded
    const sub = await entry.post('/api/activities', record(s, s.a.id, s.elA.id, '888888', 'kWh'))
    assert.equal((await entry.post(`/api/activities/${sub.body.id}/submit`)).status, 200) // submitted, not approved: excluded

    assert.equal((await entry.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).status, 403)
    assert.equal((await verifier.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).status, 403)
    assert.equal((await entry.get('/api/calculations/runs')).status, 403)

    const r = await reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id })
    assert.equal(r.status, 201, JSON.stringify(r.body))
    assert.equal(r.body.recordCount, 3)
    assert.equal(r.body.calculatedCount, 2)
    assert.equal(r.body.blockedCount, 1)
    assert.equal(r.body.notCalculableCount, 0)
    near(r.body.totals.SCOPE2_MARKET.gross, 852 + 355, 0.01) // no instruments: grid average (Q-02)
    assert.equal(dec(r.body.totals.SCOPE1.gross).toNumber(), 0)
    assert.equal(r.body.engineVersion, 'TC-DOM-002a v0.1')
    near(r.body.scope2LocationTCO2e, 852 + 355, 0.01) // 500 MWh x 0.710 = 355
    assert.equal(r.body.scope2LocationBoundaryTCO2e, null) // no approved boundary

    assert.equal((await verifier.get(`/api/calculations/runs/${r.body.id}`)).status, 404) // period not granted
    const detail = await reviewer.get(`/api/calculations/runs/${r.body.id}`)
    assert.equal(detail.status, 200)
    assert.equal(detail.body.results.total, 5) // 2 electricity records x (C-06, C-07) + 1 blocked fuel
    const a = detail.body.results.rows.find((x: { activityRecordId: string; formulaCode: string }) => x.activityRecordId === recA && x.formulaCode === 'C-06')
    assert.equal(a.emissionFactor.code, 'EF-0020')
    assert.equal(a.formulaCode, 'C-06')
    near(a.tCO2e, 852, 0.01)
    near(a.kgCO2e, 852000, 0.1)
    assert.equal(a.inputs.convertedQuantity, '1200')
    assert.equal(detail.body.awaitingConfirmation, 3) // Plant B C-06 (all-India fallback) + both C-07 (Q-02)
    assert.equal(detail.body.results.rows.find((x: { status: string }) => x.status === 'BLOCKED').issues[0].code, 'SRC-01')
    assert.deepEqual(detail.body.sites.map((x: { facility: { name: string } }) => x.facility.name), ['Plant A', 'Plant B'])

    // The record shows its latest calculation to roles that may read results, not to data entry.
    assert.equal((await reviewer.get(`/api/activities/${recA}`)).body.calculation.emissionFactor.code, 'EF-0020')
    assert.equal((await entry.get(`/api/activities/${recA}`)).body.calculation, null)
    assert.ok(await db.auditLog.findFirst({ where: { action: 'calculation.run', entityId: r.body.id } }))
  })

  test('fallback results need a confirmation with a reason, recorded once and audited', async () => {
    const s = await setupOrg('Calc Confirm Org')
    const entry = await signInAs(base, s.org.id, 'DATA_ENTRY')
    const admin = await signInAs(base, s.org.id, 'TENANT_ADMIN')
    await approved(s, entry, record(s, s.b.id, s.elB.id, '500', 'MWh'))
    const runId = (await admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body.id
    const pending = (await admin.get(`/api/calculations/runs/${runId}?attention=true&line=SCOPE2_LOCATION`)).body.results.rows
    assert.equal(pending.length, 1)
    assert.equal(pending[0].issues[0].code, 'R-09')
    const url = `/api/calculations/results/${pending[0].id}/confirm`
    assert.equal((await entry.post(url, { reason: 'Site draws from the southern grid' })).status, 403)
    assert.equal((await admin.post(url, { reason: '' })).status, 400)
    assert.equal((await admin.post(url, { reason: 'No CEA regional value published yet; disclosed in report' })).status, 200)
    assert.equal((await admin.post(url, { reason: 'again' })).status, 409)
    assert.equal((await admin.get(`/api/calculations/runs/${runId}`)).body.awaitingConfirmation, 1) // the C-07 result still waits
    assert.ok(await db.auditLog.findFirst({ where: { action: 'calculation.result_confirmed', entityId: pending[0].id } }))
  })

  test('the approved boundary weights the roll-up; runs are kept as history', async () => {
    const s = await setupOrg('Calc Boundary Org')
    const entry = await signInAs(base, s.org.id, 'DATA_ENTRY')
    const admin = await signInAs(base, s.org.id, 'TENANT_ADMIN')
    await approved(s, entry, record(s, s.a.id, s.elA.id, '1200000', 'kWh'))
    await approved(s, entry, record(s, s.b.id, s.elB.id, '500', 'MWh'))
    const first = (await admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body

    const boundary = `/api/platform/organizations/${s.org.id}/boundary`
    const f = (id: string, equityShare: number, gridLocation: string) => ({ facilityId: id, equityShare, scope1Active: true, scope2Active: true, gridLocation })
    assert.equal((await sa.put(boundary, { approach: 'EQUITY', baseYear: 2024, effectiveFrom: '2024-04-01', facilities: [f(s.a.id, 62.5, 'India - National Average'), f(s.b.id, 100, 'India - Southern Grid')] })).status, 200)
    assert.equal((await sa.post(`${boundary}/approve`)).status, 200)

    const second = (await admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body
    near(second.scope2LocationTCO2e, 1207, 0.01)
    near(second.scope2LocationBoundaryTCO2e, 852 * 0.625 + 355, 0.01) // 532.5 + 355
    const sites = (await admin.get(`/api/calculations/runs/${second.id}`)).body.sites
    near(sites[0].lines.SCOPE2_LOCATION.countedTCO2e, 532.5, 0.01)

    const history = (await admin.get(`/api/calculations/runs?reportingPeriodId=${s.period.id}`)).body
    assert.deepEqual(history.map((x: { id: string }) => x.id), [second.id, first.id])
    assert.equal(history[1].scope2LocationBoundaryTCO2e, null) // the first run is unchanged
  })

  test('boundary setup refuses grid locations that are not listed regions', async () => {
    const s = await setupOrg('Calc Grid Names Org')
    const r = await sa.put(`/api/platform/organizations/${s.org.id}/boundary`, {
      approach: 'OPERATIONAL', baseYear: 2024, effectiveFrom: '2024-04-01',
      facilities: [{ facilityId: s.a.id, operationalControl: true, scope2Active: true, gridLocation: 'Atlantis Grid' }],
    })
    assert.equal(r.status, 400)
    assert.match(r.body.error, /Atlantis Grid/)
  })
})

describe('emission factor library', () => {
  const fy2526 = { code: 'EF-T2526', activityCode: 'A-GRID', regionCode: 'IN-ALL', value: '0.7', numeratorUnit: 'tCO2e', denominatorUnit: 'MWh', source: 'CEA CO2 Baseline Database', sourceVersion: 'v22 (test)', validFrom: '2025-04-01', validTo: '2026-03-31', geography: 'India — all-India grid', tier: 'Tier 2' }

  test('everyone signed in can read it; only Super Admins add to it; nobody edits it', async () => {
    const org = await makeOrg('Factor Lib Org')
    const admin = await signInAs(base, org.id, 'TENANT_ADMIN')
    const lib = await admin.get('/api/reference/emission-factors')
    assert.equal(lib.status, 200)
    assert.equal(lib.body.total, SEED_FACTORS.length) // every workbook tab 04 row with a value
    assert.equal(lib.body.rows.length, 50) // paged
    const ef20 = (await admin.get('/api/reference/emission-factors?q=EF-0020')).body.rows
    assert.deepEqual(ef20.map((f: { code: string }) => f.code), ['EF-0020'])
    assert.equal(ef20[0].value, '0.71') // stored as published (R-10)
    assert.equal((await admin.get('/api/reference/emission-factors?q=sf6')).body.rows[0].code, 'EF-0300')
    assert.equal((await admin.post('/api/platform/emission-factors', fy2526)).status, 403)
    assert.equal((await sa.post('/api/platform/emission-factors', { ...fy2526, regionCode: null, code: 'EF-NOREG' })).status, 400)
    assert.equal((await sa.post('/api/platform/emission-factors', { ...fy2526, validTo: '2025-01-01', code: 'EF-BADDATES' })).status, 400)
    assert.equal((await sa.post('/api/platform/emission-factors', { ...fy2526, code: 'EF-0020' })).status, 409) // codes are unique
    assert.equal((await sa.patch('/api/platform/emission-factors/x', { value: '1' })).status, 404)
    assert.equal((await (await signInAs(base, org.id, 'VERIFIER')).get('/api/reference/grid-regions')).body[0].name, 'India - National Average')
  })

  test('a period with no factor is blocked until the factor for its year is added, then calculates with it', async () => {
    const s = await setupOrg('Factor Year Org')
    const period = await db.reportingPeriod.create({ data: { organizationId: s.org.id, name: 'FY2025-26', startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31') } })
    const entry = await signInAs(base, s.org.id, 'DATA_ENTRY')
    const admin = await signInAs(base, s.org.id, 'TENANT_ADMIN')
    await approved(s, entry, { ...record(s, s.a.id, s.elA.id, '1000', 'MWh'), reportingPeriodId: period.id, startDate: '2025-04-01', endDate: '2026-03-31' })

    const blocked = (await admin.post('/api/calculations/runs', { reportingPeriodId: period.id })).body
    assert.equal(blocked.blockedCount, 1)
    assert.equal(dec(blocked.scope2LocationTCO2e).toNumber(), 0)
    const row = (await admin.get(`/api/calculations/runs/${blocked.id}`)).body.results.rows[0]
    assert.equal(row.status, 'BLOCKED')
    assert.equal(row.issues[0].code, 'V-03')

    const proposed = await sa.post('/api/platform/emission-factors', fy2526)
    assert.equal(proposed.status, 201)
    assert.equal(proposed.body.status, 'DRAFT') // a new factor is never usable on creation (TC-ARC-006 A-2)
    assert.equal((await admin.post('/api/calculations/runs', { reportingPeriodId: period.id })).body.blockedCount, 1)
    assert.equal((await sa.post(`/api/emission-factors/${proposed.body.id}/approve`, { checks: { source: true, units: true, tier: true, validity: true } })).body.status, 'APPROVED')
    assert.ok(await db.auditLog.findFirst({ where: { action: 'emission_factor.published' } }))
    const ok = (await admin.post('/api/calculations/runs', { reportingPeriodId: period.id })).body
    assert.equal(ok.calculatedCount, 1)
    near(ok.scope2LocationTCO2e, 700, 0.01)
  })
})

describe('comparing runs', () => {
  test('shows what changed between two runs and why, per record, without touching either run', async () => {
    const s = await setupOrg('Calc Compare Org')
    const entry = await signInAs(base, s.org.id, 'DATA_ENTRY')
    const reviewer = await signInAs(base, s.org.id, 'REVIEWER')
    const recA = await approved(s, entry, record(s, s.a.id, s.elA.id, '1200000', 'kWh'))
    const first = await reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id })
    assert.equal(first.status, 201)
    await approved(s, entry, record(s, s.b.id, s.elB.id, '500', 'MWh'))
    const second = await reviewer.post('/api/calculations/runs', { reportingPeriodId: s.period.id, gwpSet: 'AR5', gwpReason: 'Matching the customer contract' })
    assert.equal(second.status, 201)
    const before = await db.calculationResult.findMany({ where: { runId: first.body.id }, orderBy: { id: 'asc' } })

    const c = await reviewer.get(`/api/calculations/compare?from=${first.body.id}&to=${second.body.id}`)
    assert.equal(c.status, 200)
    assert.equal(c.body.gwpChanged, true)
    const added = c.body.rows.filter((r: { causes: string[] }) => r.causes.includes('ADDED'))
    assert.ok(added.length >= 1 && added.every((r: { tCO2eBefore: null }) => r.tCO2eBefore === null))
    const a = c.body.rows.find((r: { activityRecordId: string }) => r.activityRecordId === recA)
    assert.ok(a.causes.includes('GWP')); assert.ok(!a.causes.includes('ACTIVITY_DATA'))
    assert.ok(Math.abs(c.body.totalAfter - c.body.totalBefore - Object.values(c.body.byCause as Record<string, number>).reduce((x, y) => x + y, 0)) < 1e-9)
    assert.deepEqual(await db.calculationResult.findMany({ where: { runId: first.body.id }, orderBy: { id: 'asc' } }), before)
    assert.equal((await entry.get(`/api/calculations/compare?from=${first.body.id}&to=${second.body.id}`)).status, 403)
    const other = await signInAs(base, (await setupOrg('Calc Compare Other')).org.id, 'REVIEWER')
    assert.equal((await other.get(`/api/calculations/compare?from=${first.body.id}&to=${second.body.id}`)).status, 404)
  })
})

describe('factor versions', () => {
  test('lists every version of a factor with the change between them; members see only their own usage', async () => {
    const s = await setupOrg('Factor Versions Org')
    const reviewer = await signInAs(base, s.org.id, 'REVIEWER')
    const any = await db.emissionFactor.findFirstOrThrow({ where: { activityCode: { not: null } } })
    const r = await reviewer.get(`/api/reference/emission-factors/${any.id}/versions`)
    assert.equal(r.status, 200)
    assert.equal(r.body.platform, false)
    assert.ok(r.body.versions.some((v: { id: string }) => v.id === any.id))
    assert.ok(r.body.versions.every((v: { organizations: null; results: number }) => v.organizations === null && v.results === 0))
    assert.equal(r.body.versions[0].changePercent, null)
    assert.equal((await reviewer.get('/api/reference/emission-factors/00000000-0000-4000-8000-000000000000/versions')).status, 404)
  })
})
