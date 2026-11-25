// Client feedback round 1 (factor library, NCV/density, Tier 3 register, GWP set, fossil/biogenic, shared vs
// organisation factors, steam/removals), against workbook TC-DOM-002a. Engine checks first, then the API.
import assert from 'node:assert/strict'
import { after, before, describe, test } from 'node:test'
import { checkFactorShape, usableFactor } from '../src/calc/core/factorRules.js'
import type { ActivityTypeRow, FactorRow, FuelPropertyRow, GwpSet, RecordInput, Reference } from '../src/calc/core/types.js'
import { calculate, isCalculable } from '../src/calc/registry.js'
import { ACTIVITY_TYPES, GRID_REGIONS, SEED_FACTORS, UNITS } from '../src/calc/referenceData.js'
import { getPrisma } from '../src/config/database.js'
import { makeOrg, signInAs, signInSuperAdmin, startServer } from './helpers.js'

// ---- engine fixtures: the workbook seed exactly as the database holds it ----------------------------
const UNIT_ROWS = UNITS.map(([code, , dimension, , toBase]) => ({ code, dimension, toBase }))
const factorRow = (f: (typeof SEED_FACTORS)[number] & { organizationId?: string | null; status?: string }): FactorRow => ({
  id: f.id ?? `seed-${f.code}`, code: f.code, activityCode: f.activityCode, gas: f.gas, value: f.value, numeratorUnit: f.numeratorUnit,
  denominatorUnit: f.denominatorUnit, carbonOrigin: f.carbonOrigin, source: f.source, sourceVersion: f.sourceVersion, tier: f.tier,
  validFrom: new Date(f.validFrom), validTo: f.validTo ? new Date(f.validTo) : null, regionCode: f.regionCode, createdAt: new Date('2026-01-01'),
  gwpSet: f.gwpSet, status: f.status ?? 'APPROVED', organizationId: f.organizationId ?? null,
})
const FACTORS = SEED_FACTORS.map(factorRow)
const TYPES = new Map(ACTIVITY_TYPES.map((a) => [a.code, a as unknown as ActivityTypeRow]))
const FY2425 = new Date('2024-04-01')
const ref = (codes: string[], opts: { gwpSet?: GwpSet; factors?: FactorRow[]; fuelProperties?: FuelPropertyRow[]; types?: ActivityTypeRow[] } = {}): Reference => ({
  units: UNIT_ROWS,
  regions: GRID_REGIONS.map(([code, name, , fallbackCode]) => ({ code, name, fallbackCode })),
  factors: opts.factors ?? FACTORS,
  activityTypes: opts.types ?? codes.map((c) => TYPES.get(c)!),
  gwpSet: opts.gwpSet ?? 'AR6',
  fuelProperties: opts.fuelProperties,
})
const rec = (quantity: string, unit: string, parameters: Record<string, unknown> = {}, extra: Partial<RecordInput> = {}): RecordInput =>
  ({ quantity, unit, gridLocation: null, periodStart: FY2425, parameters, ...extra })
const formula = (code: string) => TYPES.get(code)!.formulaCode!
const run = (code: string, r: RecordInput, opts: Parameters<typeof ref>[1] = {}) => calculate(r, ref([code], opts), formula(code))
const codes = (o: { issues: { code: string }[] }) => o.issues.map((i) => i.code)
const near = (actual: unknown, expected: number, tolerance: number) =>
  assert.ok(Math.abs(Number(String(actual)) - expected) <= tolerance, `${actual} is not within ${tolerance} of ${expected}`)

describe('1. factor validation against the workbook activity → unit mappings', () => {
  const coal = TYPES.get('A-COAL')!
  test('coal per ton-hour is refused; coal per TJ (NCV) is accepted in the workbook spelling', () => {
    const bad = checkFactorShape({ gas: 'CO2e', numeratorUnit: 'tCO2e', denominatorUnit: 'ton-hour' }, coal, UNIT_ROWS)
    assert.equal(bad.ok, false)
    assert.match((bad as { message: string }).message, /kg CO2 per TJ \(NCV\)/)
    const good = checkFactorShape({ gas: 'CO2', numeratorUnit: 'kgCO2', denominatorUnit: 'TJ(NCV)' }, coal, UNIT_ROWS)
    assert.deepEqual(good, { ok: true, shape: { gas: 'CO2', numeratorUnit: 'kg CO2', denominatorUnit: 'TJ (NCV)' } })
    assert.equal(checkFactorShape({ gas: 'SF6', numeratorUnit: 'kg CO2', denominatorUnit: 'TJ (NCV)' }, coal, UNIT_ROWS).ok, false) // gas checked too
  })

  test('grid electricity converts by tab 03 (kgCO2e per kWh is fine; per kg is not); steam per GJ or ton-hour; removals take no factor', () => {
    const grid = TYPES.get('A-GRID')!
    assert.deepEqual(checkFactorShape({ gas: 'CO2e', numeratorUnit: 'kgCO2e', denominatorUnit: 'kWh' }, grid, UNIT_ROWS), { ok: true, shape: { gas: 'CO2e', numeratorUnit: 'kgCO2e', denominatorUnit: 'kWh' } })
    assert.equal(checkFactorShape({ gas: 'CO2e', numeratorUnit: 'tCO2e', denominatorUnit: 'kg' }, grid, UNIT_ROWS).ok, false)
    assert.equal(checkFactorShape({ gas: 'CO2e', numeratorUnit: 'kg CO2e', denominatorUnit: 'GJ' }, TYPES.get('A-STEAM')!, UNIT_ROWS).ok, true)
    assert.equal(checkFactorShape({ gas: 'CO2e', numeratorUnit: 'kg CO2e', denominatorUnit: 'ton-hour' }, TYPES.get('A-COOL')!, UNIT_ROWS).ok, true)
    assert.match((checkFactorShape({ gas: 'CO2e', numeratorUnit: 'tCO2e', denominatorUnit: 't' }, TYPES.get('A-CO2-REC')!, UNIT_ROWS) as { message: string }).message, /metered tonnes/)
  })

  test('14. every seeded workbook factor fits its own activity\'s formula, so validation never rejects workbook data', () => {
    const rejected = FACTORS.filter((f) => f.activityCode && TYPES.get(f.activityCode)?.formulaCode && !usableFactor(f, TYPES, UNIT_ROWS))
    assert.deepEqual(rejected.map((f) => f.code), [])
  })

  test('3. only ACTIVE factors are selectable; an invalid or withdrawn row is skipped, never used', () => {
    const ef1 = FACTORS.find((f) => f.code === 'EF-0001')!
    assert.equal(usableFactor({ ...ef1, status: 'SUPERSEDED' }, TYPES, UNIT_ROWS), false)
    assert.equal(usableFactor({ ...ef1, status: 'DRAFT' }, TYPES, UNIT_ROWS), false)
    const ef9999 = { ...ef1, id: 'x', code: 'EF-9999', gas: 'CO2e', value: '2.5', numeratorUnit: 'tCO2e', denominatorUnit: 'ton-hour', source: 'testing supplier' }
    assert.equal(usableFactor(ef9999, TYPES, UNIT_ROWS), false)
  })
})

describe('2/4/5. NCV and density from structured fields', () => {
  test('structured defaults match the workbook: diesel 43 GJ/t and 0.84 kg/l, furnace oil 40.4 GJ/t and 0.96 kg/l, coal no density', () => {
    const a = (c: string) => ACTIVITY_TYPES.find((x) => x.code === c)!
    assert.deepEqual([a('A-DIESEL-M').defaultNcv, a('A-DIESEL-M').defaultNcvPublished, a('A-DIESEL-M').defaultDensity, a('A-DIESEL-M').defaultDensityUnit], ['0.043', '43.0 GJ/t', '0.84', 'kg/l'])
    assert.deepEqual([a('A-FO').defaultNcv, a('A-FO').defaultDensity], ['0.0404', '0.96'])
    assert.equal(a('A-COAL').defaultDensity, null)
    assert.equal(ACTIVITY_TYPES.filter((x) => /combustion/.test(x.category) && !x.defaultNcv).length, 0) // every fuel has an NCV
  })

  test('litres, kilolitres and US gallons reach the same tonnes; energy entries skip density', () => {
    const p = { density: '0.84', densityUnit: 'kg/l' }
    assert.equal(run('A-ST-DIESEL-GAS-OIL', rec('1000', 'l', p)).inputs.massTonnes, '0.84')
    assert.equal(run('A-ST-DIESEL-GAS-OIL', rec('1', 'kl', p)).inputs.massTonnes, '0.84')
    near(run('A-ST-DIESEL-GAS-OIL', rec('264.172052', 'gal', p)).inputs.massTonnes, 0.84, 1e-6)
    const gj = run('A-ST-DIESEL-GAS-OIL', rec('36.12', 'GJ', { energyBasis: 'NCV' }))
    assert.equal(gj.inputs.energyTJ, '0.03612') // = 0.84 t × 0.043 TJ/t
    assert.equal(gj.inputs.densityUsed, undefined)
  })

  test('the source of every value is recorded: entered, default', () => {
    const def = run('A-ST-DIESEL-GAS-OIL', rec('1000', 'l'))
    assert.equal(def.inputs.densitySource, 'IPCC 2006 vol.2 default, indicative')
    assert.equal(def.inputs.ncvSource, 'IPCC default')
    const own = run('A-ST-DIESEL-GAS-OIL', rec('1000', 'l', { density: '0.85', densityUnit: 'kg/l', ncv: '0.0428' }))
    assert.deepEqual([own.inputs.densitySource, own.inputs.ncvSource], ['entered', 'entered'])
  })

  test('missing values block explicitly instead of being assumed (V-09, C-23)', () => {
    assert.deepEqual(codes(run('A-ST-ORIMULSIO', rec('500', 'l'))), ['V-09'])
    const noNcv = { ...TYPES.get('A-COAL')!, defaultNcv: null }
    const o = calculate(rec('10', 't'), ref([], { types: [noNcv] }), 'C-01')
    assert.deepEqual(codes(o), ['C-23'])
  })
})

describe('6. monthly site fuel properties (Tier 3)', () => {
  const fp = (over: Partial<FuelPropertyRow>): FuelPropertyRow => ({
    id: 'fp1', facilityId: 'F1', activityCode: 'A-COAL', month: new Date('2024-05-01'), version: 1, status: 'APPROVED',
    ncv: null, density: null, densityUnit: null, carbonContent: null, oxidationFactor: null, biogenicShare: null, certificateRef: 'LAB-24-05', ...over,
  })
  const may = { facilityId: 'F1', startDate: new Date('2024-05-01'), endDate: new Date('2024-05-31') }

  test('an approved monthly NCV is applied to a record inside that month, and recorded', () => {
    const o = run('A-COAL', rec('1250', 't', {}, may), { fuelProperties: [fp({ ncv: '0.0196' })] })
    assert.equal(o.inputs.ncvUsed, '0.0196')
    assert.equal(o.inputs.ncvSource, 'fuel properties register (approved)')
    assert.deepEqual(o.inputs.fuelProperty, { id: 'fp1', month: '2024-05-01', version: 1, certificateRef: 'LAB-24-05' })
    assert.ok(codes(o).includes('V-10')) // 24% below the IPCC default: still range-checked
    near(o.tCO2e, 2317.7 + 1250 * 0.0196 * (10 * 29.8 + 1.5 * 273) / 1000, 0.01) // EG-1 CO2 plus CH4 and N2O
  })

  test('a record\'s own value beats the register; the register beats the default', () => {
    const o = run('A-COAL', rec('1250', 't', { ncv: '0.025' }, may), { fuelProperties: [fp({ ncv: '0.0196' })] })
    assert.equal(o.inputs.ncvUsed, '0.025')
  })

  test('values awaiting approval are never used, and the record says so (FP-01); the latest approved version wins', () => {
    const pending = run('A-COAL', rec('1250', 't', {}, may), { fuelProperties: [fp({ status: 'DRAFT', ncv: '0.0196' })] })
    assert.equal(pending.inputs.ncvSource, 'IPCC default')
    assert.ok(codes(pending).includes('FP-01'))
    const versions = [fp({ id: 'v1', ncv: '0.0196' }), fp({ id: 'v2', version: 2, ncv: '0.0201' }), fp({ id: 'v3', version: 3, status: 'DRAFT', ncv: '0.03' })]
    const o = run('A-COAL', rec('1250', 't', {}, may), { fuelProperties: versions })
    assert.equal(o.inputs.ncvUsed, '0.0201')
    assert.match(o.issues.find((i) => i.code === 'FP-01')!.message, /approved version 2/)
  })

  test('a record spanning several months does not take one month\'s values (FP-02); another facility\'s values never apply', () => {
    const o = run('A-COAL', rec('1250', 't', {}, { ...may, endDate: new Date('2024-06-30') }), { fuelProperties: [fp({ ncv: '0.0196' })] })
    assert.equal(o.inputs.ncvSource, 'IPCC default')
    assert.ok(codes(o).includes('FP-02'))
    assert.equal(run('A-COAL', rec('1250', 't', {}, { ...may, facilityId: 'F2' }), { fuelProperties: [fp({ ncv: '0.0196' })] }).inputs.ncvSource, 'IPCC default')
  })

  test('rule 1: CO2 from the laboratory carbon content (C × 44/12 × oxidation), with V-11 against the IPCC factor', () => {
    // 100 t coal, 50% carbon: 100 × 0.5 × 44/12 = 183.333 t CO2, i.e. 71,059 kg/TJ at the default NCV: 25% below EF-0001.
    const o = run('A-COAL', rec('100', 't', {}, may), { fuelProperties: [fp({ carbonContent: '0.5' })] })
    near(o.gases!.CO2, 183333.333, 0.01)
    assert.equal((o.selection as { co2Tier: string }).co2Tier, 'Tier 3 - site laboratory analysis')
    assert.ok(codes(o).includes('V-11'))
    // 66% carbon: 242 t CO2, 93,798 kg/TJ, within 10% of EF-0001. The oxidation factor scales the result.
    const close = run('A-COAL', rec('100', 't', {}, may), { fuelProperties: [fp({ carbonContent: '0.66' })] })
    near(close.gases!.CO2, 242000, 0.01)
    assert.ok(!codes(close).includes('V-11'))
    near(run('A-COAL', rec('100', 't', {}, may), { fuelProperties: [fp({ carbonContent: '0.66', oxidationFactor: '0.98' })] }).gases!.CO2, 242000 * 0.98, 0.01)
  })

  test('rule 5: an own CO2 factor needs a source and is range-checked (V-11)', () => {
    const o = run('A-COAL', rec('100', 't', { co2Factor: '80000' }))
    assert.deepEqual(codes(o).filter((c) => c === 'V-11').length, 2) // 15% off, and no source
    assert.ok(!codes(run('A-COAL', rec('100', 't', { co2Factor: '95000', co2FactorSource: 'Ultimate analysis 24/117' }))).includes('V-11'))
  })
})

describe('7. GWP set from the structured column, AR6 and AR5 independently', () => {
  test('R-410A: 12 kg top-up = 27.066 t (AR6, 2255.5) or 23.082 t (AR5, 1923.5 from the workbook note)', () => {
    const o6 = run('A-FU-R-410A', rec('12', 'kg'))
    const o5 = run('A-FU-R-410A', rec('12', 'kg'), { gwpSet: 'AR5' })
    near(o6.tCO2e, 27.066, 0.001)
    near(o5.tCO2e, 23.082, 0.001)
    assert.match(o5.factor!.code, /-AR5$/)
    assert.equal(o6.factor!.code, o5.factor!.code.replace('-AR5', ''))
  })

  test('WE-01 diesel under AR5 uses 28 and 265 (fossil CH4, N2O); the CO2 part is unchanged', () => {
    const p = { density: '0.84', densityUnit: 'kg/l' }
    const o6 = run('A-ST-DIESEL-GAS-OIL', rec('10000', 'l', p))
    const o5 = run('A-ST-DIESEL-GAS-OIL', rec('10000', 'l', p), { gwpSet: 'AR5' })
    near(o6.tCO2e, 26.8564, 0.001) // WE-01
    const tj = 10000 * 0.84 / 1000 * 0.043
    near(o5.tCO2e, (tj * 74100 + tj * 3 * 28 + tj * 0.6 * 265) / 1000, 1e-9)
    assert.equal((o5.selection as { gwp: { set: string; basis: string } }).gwp.set, 'AR5')
  })

  test('the set is read from gwpSet, not from the source-version text', () => {
    const relabelled = FACTORS.map((f) => (f.activityCode === null ? { ...f, sourceVersion: 'see note', gwpSet: f.gwpSet } : f))
    near(run('A-FU-R-410A', rec('12', 'kg'), { factors: relabelled }).tCO2e, 27.066, 0.001)
    const unset = FACTORS.map((f) => (f.activityCode === null ? { ...f, gwpSet: null } : f))
    assert.deepEqual(codes(run('A-ST-DIESEL-GAS-OIL', rec('10000', 'l', { density: '0.84', densityUnit: 'kg/l' }), { factors: unset })).at(-1), 'V-03')
  })
})

describe('8/9. fossil, biogenic and blends', () => {
  test('biomass: CO2 is a memo item outside the total; CH4 uses the non-fossil GWP (WE-05/06)', () => {
    const o = run('A-ST-WOOD-WOOD-WASTE', rec('200', 't'))
    near(o.tCO2e, 5.9342, 0.001)
    near(o.biogenicTCO2, 349.44, 0.01)
  })

  test('V-17: a record tagged against its fuel is blocked; V-02: no origin at all is blocked', () => {
    assert.deepEqual(codes(run('A-ST-WOOD-WOOD-WASTE', rec('200', 't', { carbonOrigin: 'Fossil' }))), ['V-17'])
    assert.deepEqual(codes(run('A-COAL', rec('10', 't', { carbonOrigin: 'Biogenic' }))), ['V-17'])
    const noOrigin = { ...TYPES.get('A-COAL')!, carbonOrigin: '' }
    assert.deepEqual(codes(calculate(rec('10', 't'), ref([], { types: [noOrigin] }), 'C-01')), ['V-02'])
  })

  test('a B7 blend splits CO2 by the certified biogenic share; CH4 takes the share-weighted GWP', () => {
    const p = { density: '0.84', densityUnit: 'kg/l', carbonOrigin: 'Mixed', biogenicSharePct: '7', biogenicShareEvidence: 'IOCL B7 certificate 2024-05' }
    const o = run('A-MO-DIESEL', rec('1000', 'l', p))
    const tj = 0.84 * 0.043
    const co2 = tj * 74100, ch4 = tj * 3.9, n2o = tj * 3.9
    near(o.gases!.CO2_fossil, co2 * 0.93, 1e-9)
    near(o.biogenicTCO2, co2 * 0.07 / 1000, 1e-12)
    near(o.tCO2e, (co2 * 0.93 + ch4 * (0.93 * 29.8 + 0.07 * 27) + n2o * 273) / 1000, 1e-9)
    assert.ok(codes(o).includes('J-12') && o.needsConfirmation)
  })

  test('blend shares must be complete and evidenced', () => {
    const p = { density: '0.84', densityUnit: 'kg/l', carbonOrigin: 'Mixed' }
    assert.deepEqual(codes(run('A-MO-DIESEL', rec('1000', 'l', p))), ['J-16'])
    assert.deepEqual(codes(run('A-MO-DIESEL', rec('1000', 'l', { ...p, biogenicSharePct: '7' }))), ['J-12'])
    assert.deepEqual(codes(run('A-MO-DIESEL', rec('1000', 'l', { ...p, biogenicSharePct: '7', fossilSharePct: '90', biogenicShareEvidence: 'x' }))), ['J-16'])
    assert.deepEqual(codes(run('A-MO-DIESEL', rec('1000', 'l', { ...p, biogenicSharePct: '100', biogenicShareEvidence: 'x' }))), ['J-16'])
    assert.deepEqual(codes(run('A-MO-DIESEL', rec('1000', 'l', { ...p, biogenicSharePct: '7', biogenicShareEvidence: 'x' }), { gwpSet: 'AR5' })).at(-1), 'V-03') // no AR5 non-fossil CH4
  })
})

describe('11. steam, heat and cooling: supplier-specific only', () => {
  test('no factor on the record and none of the organisation\'s own: blocked with what is needed (V-19)', () => {
    const o = run('A-STEAM', rec('100', 'GJ'))
    assert.deepEqual(codes(o), ['V-19'])
    assert.match(o.issues[0].message, /Supplier-specific emission factor required/)
  })

  test('the organisation\'s own cooling factor per ton-hour is used; a shared one never is', () => {
    const base = { ...SEED_FACTORS.find((f) => f.code === 'EF-0020')!, regionCode: null, activityCode: 'A-COOL', gas: 'CO2e', value: '0.9', numeratorUnit: 'kg CO2e', denominatorUnit: 'ton-hour', gwpSet: null }
    const own = factorRow({ ...base, code: 'ORG-COOL', organizationId: 'org-1' })
    const o = run('A-COOL', rec('1000', 'ton-hour'), { factors: [...FACTORS, own] })
    assert.equal(o.status, 'CALCULATED')
    near(o.tCO2e, 0.9, 1e-12) // 1000 ton-hour × 0.9 kg ÷ 1000
    assert.deepEqual(codes(run('A-COOL', rec('1000', 'ton-hour'), { factors: [...FACTORS, factorRow({ ...base, code: 'SHARED-COOL' })] })), ['V-19'])
    near(run('A-COOL', rec('1000', 'ton-hour', { supplierFactor: '71.07' })).tCO2e, 1000 * 0.01266067 * 71.07 / 1000, 1e-9) // record factor per GJ
  })
})

describe('14. activity → factor → formula mapping', () => {
  test('every calculable fuel, gas and grid activity has its factors in force for FY2024-25; nothing calculable lacks a method', () => {
    const missing: string[] = []
    for (const a of ACTIVITY_TYPES.filter((x) => x.formulaCode)) {
      assert.ok(isCalculable(a.formulaCode), `${a.code}: formula ${a.formulaCode} has no method`)
      const has = (gas: string) => FACTORS.some((f) => f.activityCode === a.code && f.gas === gas && f.validFrom <= FY2425 && (!f.validTo || f.validTo >= FY2425))
      if (['C-01', 'C-02', 'C-03'].includes(a.formulaCode!) && !['CO2', 'CH4', 'N2O'].every(has)) missing.push(a.code)
      if (a.formulaCode === 'C-05' && !has('CO2e')) missing.push(a.code)
    }
    // Known workbook gaps (blocked with V-03, never estimated): generic biomass and refrigerant rows, and road
    // biodiesel / bioethanol, whose tab 04 rows give CO2 only (EF-0269, EF-0270), no CH4 or N2O.
    assert.deepEqual(missing.sort(), ['A-BIOM', 'A-MO-BIODIESEL', 'A-MO-BIOETHANO', 'A-REFR'])
  })
})

// ---- API: lifecycle, ownership, EF-9999, register, removals, reproducibility ------------------------

const { server, base } = startServer()
after(() => server.close())
const db = getPrisma()
type Client = Awaited<ReturnType<typeof signInSuperAdmin>>
let sa: Client
before(async () => { sa = await signInSuperAdmin(base) })

async function setup(name: string) {
  const org = await makeOrg(name)
  const facility = await db.facility.create({ data: { organizationId: org.id, name: 'Plant', code: 'P1', country: 'India', gridLocation: 'India - National Average' } })
  const period = await db.reportingPeriod.create({ data: { organizationId: org.id, name: 'FY2025-26', startDate: new Date('2025-04-01'), endDate: new Date('2026-03-31') } })
  const admin = await signInAs(base, org.id, 'TENANT_ADMIN')
  return { org, facility, period, admin }
}
// An approved record, written directly: the review workflow has its own tests.
async function approvedRecord(s: Awaited<ReturnType<typeof setup>>, sourceId: string, quantity: string, unit: string, start: string, end: string, parameters: object = {}) {
  return db.activityRecord.create({ data: {
    organizationId: s.org.id, facilityId: s.facility.id, reportingPeriodId: s.period.id, emissionSourceId: sourceId, startDate: new Date(start), endDate: new Date(end),
    quantity, unit, parameters, status: 'APPROVED', createdById: s.admin.user.id, updatedById: s.admin.user.id,
  } })
}
const gridFY2526 = { activityCode: 'A-GRID', regionCode: 'IN-ALL', value: '0.7', numeratorUnit: 'tCO2e', denominatorUnit: 'MWh', source: 'CEA CO2 Baseline Database', sourceVersion: 'v22 (test)', validFrom: '2025-04-01', validTo: '2026-03-31', geography: 'India', tier: 'Tier 2' }

const CHECKS = { checks: { source: true, units: true, tier: true, validity: true } }

describe('API: platform library lifecycle (TC-ARC-006 section 4)', () => {
  test('proposed as a draft, published after the source check, frozen, end-dated; past results keep their factor', async () => {
    const s = await setup('Lifecycle Org')
    const grid = await db.emissionSource.create({ data: { organizationId: s.org.id, facilityId: s.facility.id, name: 'Grid', category: 'PURCHASED_ELECTRICITY', activityCode: 'A-GRID' } })
    await approvedRecord(s, grid.id, '1000', 'MWh', '2025-04-01', '2025-04-30')
    const calc = async () => (await s.admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body

    const draft = (await sa.post('/api/platform/emission-factors', { ...gridFY2526, code: 'EF-LC-1' })).body
    assert.equal(draft.status, 'DRAFT')
    assert.equal((await calc()).blockedCount, 1) // a draft is never used
    assert.equal((await s.admin.get('/api/reference/emission-factors?q=EF-LC-1')).body.total, 0) // tenants never see platform drafts
    assert.equal((await sa.patch(`/api/emission-factors/${draft.id}`, { value: '0.69' })).body.value, '0.69')
    assert.equal((await sa.patch(`/api/emission-factors/${draft.id}`, { denominatorUnit: 'kg' })).status, 400) // same validation on edit
    assert.equal((await sa.post(`/api/emission-factors/${draft.id}/approve`, {})).status, 400) // the source check is confirmed
    assert.equal((await sa.post(`/api/emission-factors/${draft.id}/approve`, { ...CHECKS, note: 'Checked against CEA v22 table 3' })).body.status, 'APPROVED')
    assert.equal((await sa.patch(`/api/emission-factors/${draft.id}`, { value: '0.5' })).status, 409) // published: never edited
    assert.equal((await s.admin.post(`/api/emission-factors/${draft.id}/supersede`, { reason: 'tenants cannot touch it' })).status, 403) // read-only in tenants

    const used = await calc()
    assert.equal(used.calculatedCount, 1)
    assert.equal(Number(used.scope2LocationTCO2e), 690)
    const updates = (await s.admin.get('/api/reference/library-updates')).body
    assert.equal(updates[0].factor.code, 'EF-LC-1') // tenants are told about the new edition
    assert.equal(updates[0].action, 'published')

    assert.equal((await sa.post(`/api/emission-factors/${draft.id}/supersede`, { reason: 'x' })).status, 400) // a reason is required
    const w = (await sa.post(`/api/emission-factors/${draft.id}/supersede`, { reason: 'Superseded by the published CEA v22', endDate: '2025-03-31' })).body
    assert.deepEqual([w.status, w.usage.results, w.validTo.slice(0, 10)], ['SUPERSEDED', 2, '2025-04-01']) // never end-dated before it starts
    assert.equal((await calc()).blockedCount, 1) // not selectable any more

    const kept = await db.calculationResult.findFirst({ where: { runId: used.id, formulaCode: 'C-06' } })
    assert.equal(kept!.emissionFactorId, draft.id) // the earlier run still points at it, with its value and units
    assert.deepEqual([kept!.factorValue!.toString(), kept!.factorUnit], ['0.69', 'tCO2e / MWh'])
    assert.equal(Number((await db.calculationRun.findUnique({ where: { id: used.id } }))!.scope2LocationTCO2e), 690)

    const history = (await s.admin.get(`/api/reference/emission-factors/${draft.id}/history`)).body
    assert.deepEqual(history.events.map((e: { action: string }) => e.action), ['emission_factor.created', 'emission_factor.updated', 'emission_factor.published', 'emission_factor.superseded'])
    assert.equal(history.label, 'Platform library · Tier 2')
    assert.equal(history.events.at(-1).reason, 'Superseded by the published CEA v22')
  })
})

describe('API: EF-9999 and manually created factors (1, 2)', () => {
  test('a legacy coal "per ton-hour" factor is flagged unusable, never selected, and can be end-dated', async () => {
    // As it exists on the live site: added before validation existed, by a Super Admin, never used.
    const legacy = await db.emissionFactor.create({ data: {
      code: 'EF-9999', activityCode: 'A-COAL', gas: 'CO2e', value: '2.5', numeratorUnit: 'tCO2e', denominatorUnit: 'ton-hour', carbonOrigin: 'Fossil', status: 'APPROVED',
      source: 'testing supplier', sourceVersion: 'test', validFrom: new Date('2024-04-01'), geography: 'India', tier: 'Tier 3', createdById: sa.user.id,
    } })
    const row = (await sa.get('/api/reference/emission-factors?q=EF-9999')).body.rows[0]
    assert.equal(row.usable, false)
    assert.match(row.problem, /does not fit Coal/)

    // The same row can no longer be created, and the user is pointed to the request path instead.
    const again = await sa.post('/api/platform/emission-factors', { code: 'EF-9998', activityCode: 'A-COAL', value: '2.5', numeratorUnit: 'tCO2e', denominatorUnit: 'ton-hour', source: 'testing supplier', sourceVersion: 'test', validFrom: '2024-04-01', geography: 'India', tier: 'Tier 3' })
    assert.equal(again.status, 400)
    assert.match(again.body.error, /request it/)

    const s = await setup('EF9999 Org')
    const coal = await db.emissionSource.create({ data: { organizationId: s.org.id, facilityId: s.facility.id, name: 'Boiler', category: 'FUEL_COMBUSTION', activityCode: 'A-COAL' } })
    await approvedRecord(s, coal.id, '100', 't', '2025-04-01', '2025-04-30')
    const runRes = (await s.admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body
    const result = await db.calculationResult.findFirst({ where: { runId: runRes.id } })
    assert.equal(result!.status, 'CALCULATED')
    assert.notEqual(result!.emissionFactorId, legacy.id)
    assert.equal(await db.calculationResult.count({ where: { emissionFactorId: legacy.id } }), 0)

    const w = (await sa.post(`/api/emission-factors/${legacy.id}/supersede`, { reason: 'Test entry: coal is not measured per ton-hour' })).body
    assert.deepEqual([w.status, w.usage.results], ['SUPERSEDED', 0])
  })

  test('a manually created valid platform factor is usable once published', async () => {
    const created = (await sa.post('/api/platform/emission-factors', { ...gridFY2526, code: 'EF-MANUAL-1' })).body
    await sa.post(`/api/emission-factors/${created.id}/approve`, CHECKS)
    const row = (await sa.get('/api/reference/emission-factors?q=EF-MANUAL-1')).body.rows[0]
    assert.deepEqual([row.status, row.usable, row.problem, row.approvedBy?.name != null], ['APPROVED', true, null, true])
    await sa.post(`/api/emission-factors/${created.id}/supersede`, { reason: 'cleanup after test' }) // keep later tests independent
  })
})

describe('API: tenant factors (TC-ARC-006 sections 1, 3 and 5)', () => {
  const steam = { code: '', activityCode: 'A-STEAM', gas: 'CO2e', value: '60', numeratorUnit: 'kg CO2e', denominatorUnit: 'GJ', source: 'Acme Steam disclosure 2025', sourceVersion: '2025', validFrom: '2025-04-01', validTo: '2026-03-31', geography: 'Site', tier: 'Tier 3 site-specific', basis: 'Supplier disclosure for the Acme boiler house; not valid for other suppliers.' }
  const pdf = Buffer.from('%PDF-1.4 supplier disclosure')

  test('draft → in review → approved by a different reviewer → in use; private to its organisation; Super Admin cannot see it', async () => {
    const a = await setup('Org Factor A')
    const b = await setup('Org Factor B')
    const entry = await signInAs(base, a.org.id, 'DATA_ENTRY')
    const reviewer = await signInAs(base, a.org.id, 'REVIEWER')
    const verifier = await signInAs(base, a.org.id, 'VERIFIER')

    assert.equal((await verifier.post('/api/emission-factors', { ...steam, code: 'A-STEAM-V' })).status, 403) // verifiers never create
    assert.equal((await entry.post('/api/emission-factors', { ...steam, code: 'A-STEAM-T', tier: 'Tier 3' })).status, 400) // tier from the list
    const created = await entry.post('/api/emission-factors', { ...steam, code: 'A-STEAM-ACME', basis: null })
    assert.equal(created.status, 201)
    const id = created.body.id
    assert.deepEqual([created.body.status, created.body.organizationId], ['DRAFT', a.org.id]) // never usable on creation

    const notReady = await entry.post(`/api/emission-factors/${id}/submit`)
    assert.equal(notReady.status, 400)
    assert.match(notReady.body.error, /evidence file/)
    assert.match(notReady.body.error, /basis/)
    assert.equal((await entry.patch(`/api/emission-factors/${id}`, { basis: steam.basis })).status, 200)
    assert.equal((await entry.upload(`/api/emission-factors/${id}/evidence`, 'disclosure.pdf', pdf)).status, 201)
    assert.equal((await entry.post(`/api/emission-factors/${id}/submit`)).body.status, 'IN_REVIEW')
    assert.equal((await entry.patch(`/api/emission-factors/${id}`, { value: '61' })).status, 409) // under review: not edited

    assert.equal((await a.admin.post(`/api/emission-factors/${id}/approve`, CHECKS)).status, 403) // Tenant Admin does not approve
    assert.equal((await reviewer.post(`/api/emission-factors/${id}/return`, { comment: 'Attach page 2 of the disclosure' })).body.status, 'DRAFT')
    assert.equal((await entry.post(`/api/emission-factors/${id}/submit`)).body.status, 'IN_REVIEW')
    assert.equal((await reviewer.post(`/api/emission-factors/${id}/approve`, { checks: { source: true, units: true, tier: true } })).status, 400) // all four checks
    const approved = (await reviewer.post(`/api/emission-factors/${id}/approve`, { ...CHECKS, note: 'Matches the signed disclosure' })).body
    assert.deepEqual([approved.status, approved.approvalNote], ['APPROVED', 'Matches the signed disclosure'])

    // Never visible to another tenant or to the Super Admin, by any route.
    assert.equal((await b.admin.get('/api/reference/emission-factors?q=A-STEAM-ACME')).body.total, 0)
    assert.equal((await b.admin.get(`/api/reference/emission-factors/${id}/history`)).status, 404)
    assert.equal((await b.admin.post(`/api/emission-factors/${id}/supersede`, { reason: 'not ours at all' })).status, 404)
    assert.equal((await sa.get('/api/reference/emission-factors?q=A-STEAM-ACME')).body.total, 0)
    assert.equal((await sa.get(`/api/reference/emission-factors/${id}/history`)).status, 404)
    assert.equal((await sa.post(`/api/emission-factors/${id}/supersede`, { reason: 'platform admin attempt' })).status, 404)
    assert.equal((await sa.patch(`/api/emission-factors/${id}`, { value: '1' })).status, 404)

    // Labelled with its tier and owner; the verifier can read the approval.
    const row = (await a.admin.get('/api/reference/emission-factors?q=A-STEAM-ACME')).body.rows[0]
    assert.equal(row.label, 'Tenant-defined · Tier 3 site-specific')
    const history = (await verifier.get(`/api/reference/emission-factors/${id}/history`)).body
    assert.equal(history.approvalNote, 'Matches the signed disclosure')
    assert.deepEqual(history.events.map((e: { action: string }) => e.action), ['emission_factor.created', 'emission_factor.updated', 'emission_factor.evidence_attached', 'emission_factor.submitted', 'emission_factor.returned', 'emission_factor.submitted', 'emission_factor.approved'])

    // Platform rules still hold for tenants.
    const shared = await db.emissionFactor.findFirst({ where: { code: 'EF-0020' } })
    assert.equal((await a.admin.post(`/api/emission-factors/${shared!.id}/supersede`, { reason: 'trying to end it' })).status, 403)
    assert.equal((await a.admin.post('/api/platform/emission-factors', { ...gridFY2526, code: 'EF-NOT-SA' })).status, 403)
    assert.equal((await sa.post('/api/platform/emission-factors', { ...steam, code: 'SHARED-STEAM' })).status, 400) // supplier-specific: never platform

    for (const s of [a, b]) {
      const src = await db.emissionSource.create({ data: { organizationId: s.org.id, facilityId: s.facility.id, name: 'Steam', category: 'PURCHASED_ENERGY', activityCode: 'A-STEAM' } })
      await approvedRecord(s, src.id, '8000', 'GJ', '2025-04-01', '2025-04-30')
    }
    const runA = (await a.admin.post('/api/calculations/runs', { reportingPeriodId: a.period.id })).body
    const runB = (await b.admin.post('/api/calculations/runs', { reportingPeriodId: b.period.id })).body
    assert.equal(Number(runA.totals.SCOPE2_HEAT.gross), 480) // WE-16: 8,000 GJ × 60 kg ÷ 1000
    assert.equal(runB.blockedCount, 1) // organisation B cannot use A's factor (V-19)

    // Used by a result: in use and frozen, for everyone.
    assert.equal((await db.emissionFactor.findUnique({ where: { id } }))!.status, 'IN_USE')
    assert.equal((await reviewer.patch(`/api/emission-factors/${id}`, { value: '59' })).status, 409)
  })

  test('nobody approves their own factor; overlaps are rejected; a new version end-dates the old one on approval', async () => {
    const s = await setup('Org Factor Versions')
    const reviewer = await signInAs(base, s.org.id, 'REVIEWER')
    const reviewer2 = await signInAs(base, s.org.id, 'REVIEWER')
    const ready = async (client: typeof reviewer, body: Record<string, unknown>) => {
      const f = (await client.post('/api/emission-factors', body)).body
      await client.upload(`/api/emission-factors/${f.id}/evidence`, 'd.pdf', pdf)
      return f
    }
    const v1 = await ready(reviewer, { ...steam, code: 'V-STEAM-1' })
    await reviewer.post(`/api/emission-factors/${v1.id}/submit`)
    const own = await reviewer.post(`/api/emission-factors/${v1.id}/approve`, CHECKS)
    assert.equal(own.status, 403) // no self-approval, not even by a reviewer (O-4)
    assert.equal((await reviewer2.post(`/api/emission-factors/${v1.id}/approve`, CHECKS)).body.status, 'APPROVED')

    // Overlapping dates for the same activity and gas cannot leave draft.
    const clash = await ready(reviewer2, { ...steam, code: 'V-STEAM-CLASH', validFrom: '2025-10-01', validTo: null })
    const refused = await reviewer2.post(`/api/emission-factors/${clash.id}/submit`)
    assert.equal(refused.status, 400)
    assert.match(refused.body.error, /overlap V-STEAM-1/)

    // A reviewer may edit an approved factor that is not yet used.
    assert.equal((await reviewer.patch(`/api/emission-factors/${v1.id}`, { basis: `${steam.basis} Confirmed by the supplier.` })).status, 200)
    assert.equal((await s.admin.patch(`/api/emission-factors/${v1.id}`, { value: '1' })).status, 403) // Tenant Admin: drafts only

    // A new version from the middle of the year replaces v1 from that date.
    const v2 = await ready(reviewer2, { ...steam, code: 'V-STEAM-2', value: '58', validFrom: '2025-10-01', validTo: '2026-03-31', supersedesId: v1.id })
    await reviewer2.post(`/api/emission-factors/${v2.id}/submit`)
    assert.equal((await reviewer.post(`/api/emission-factors/${v2.id}/approve`, CHECKS)).body.status, 'APPROVED')
    const old = (await db.emissionFactor.findUnique({ where: { id: v1.id } }))!
    assert.deepEqual([old.status, old.validTo!.toISOString().slice(0, 10)], ['SUPERSEDED', '2025-09-30'])

    // Tenant Admin may end-date; nobody may delete (there is no route).
    assert.equal((await s.admin.post(`/api/emission-factors/${v2.id}/supersede`, { reason: 'Supplier contract ended' })).body.status, 'SUPERSEDED')
    assert.equal((await s.admin.del(`/api/emission-factors/${v2.id}`)).status, 404)
  })

  test('a unit that is not offered is requested, never substituted; the platform team answers it', async () => {
    const s = await setup('Unit Request Org')
    const entry = await signInAs(base, s.org.id, 'DATA_ENTRY')
    const r = await entry.post('/api/unit-requests', { activityCode: 'A-COAL', unit: 'kg CO2 per tonne (as received)', reason: 'Our coal supplier states the factor per tonne as received.' })
    assert.equal(r.status, 201)
    assert.equal((await entry.get('/api/unit-requests')).body.length, 1)
    assert.equal((await sa.get('/api/unit-requests')).body.some((x: { id: string }) => x.id === r.body.id), true)
    assert.equal((await s.admin.post(`/api/platform/unit-requests/${r.body.id}/resolve`, { status: 'ADDED', resolution: 'n/a' })).status, 403)
    const done = (await sa.post(`/api/platform/unit-requests/${r.body.id}/resolve`, { status: 'DECLINED', resolution: 'Enter the factor per tonne (t); the basis can say as received.' })).body
    assert.equal(done.status, 'DECLINED')
  })
})

describe('API: fuel properties register (6, 13)', () => {
  test('entered, certified, approved by someone else, applied to that month, and reproducible after a correction', async () => {
    const s = await setup('Register Org')
    const coal = await db.emissionSource.create({ data: { organizationId: s.org.id, facilityId: s.facility.id, name: 'Boiler', category: 'FUEL_COMBUSTION', activityCode: 'A-COAL' } })
    await approvedRecord(s, coal.id, '1250', 't', '2025-05-01', '2025-05-31')
    const entry = await signInAs(base, s.org.id, 'DATA_ENTRY')
    const reviewer = await signInAs(base, s.org.id, 'REVIEWER')
    const body = { facilityId: s.facility.id, activityCode: 'A-COAL', month: '2025-05', ncv: '0.0196', certificateRef: 'LAB-25-05' }

    assert.equal((await entry.post('/api/fuel-properties', { ...body, ncv: '19.6' })).status, 400) // GJ/t typed as TJ/t
    assert.equal((await entry.post('/api/fuel-properties', { ...body, activityCode: 'A-GRID' })).status, 400)
    const v1 = (await entry.post('/api/fuel-properties', body)).body
    assert.deepEqual([v1.status, v1.version], ['DRAFT', 1])
    assert.equal((await reviewer.post(`/api/fuel-properties/${v1.id}/approve`, {})).status, 409) // certificate first (J-10)
    assert.equal((await entry.upload(`/api/fuel-properties/${v1.id}/certificate`, 'lab.pdf', Buffer.from('%PDF-1.4 lab'))).status, 201)
    assert.equal((await entry.post(`/api/fuel-properties/${v1.id}/approve`, {})).status, 403) // not by the person who entered it

    const before = (await s.admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body // draft: not applied
    assert.equal(((await db.calculationResult.findFirst({ where: { runId: before.id } }))!.inputs as { ncvSource: string }).ncvSource, 'IPCC default')

    assert.equal((await reviewer.post(`/api/fuel-properties/${v1.id}/approve`, { note: 'Matches the lab report' })).body.status, 'APPROVED')
    const first = (await s.admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body
    const r1 = await db.calculationResult.findFirst({ where: { runId: first.id } })
    assert.equal((r1!.inputs as { fuelProperty: { version: number } }).fuelProperty.version, 1)

    const v2 = (await entry.post('/api/fuel-properties', { ...body, ncv: '0.0201', certificateRef: 'LAB-25-05-R1' })).body
    assert.equal(v2.version, 2)
    await entry.upload(`/api/fuel-properties/${v2.id}/certificate`, 'lab2.pdf', Buffer.from('%PDF-1.4 rev'))
    await reviewer.post(`/api/fuel-properties/${v2.id}/approve`, {})
    assert.equal((await db.fuelProperty.findUnique({ where: { id: v1.id } }))!.status, 'SUPERSEDED') // kept, not overwritten
    const second = (await s.admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body
    const r2 = await db.calculationResult.findFirst({ where: { runId: second.id } })
    assert.equal((r2!.inputs as { ncvUsed: string }).ncvUsed, '0.0201')
    const r1Again = await db.calculationResult.findUnique({ where: { id: r1!.id } })
    assert.equal(r1Again!.tCO2e!.toString(), r1!.tCO2e!.toString()) // the first run is untouched
    assert.equal((r1Again!.inputs as { ncvUsed: string }).ncvUsed, '0.0196')

    const other = await setup('Register Org B')
    assert.equal((await other.admin.get('/api/fuel-properties')).body.length, 0) // tenant isolation
    assert.equal((await other.admin.raw(`/api/fuel-properties/${v1.id}/certificate`)).status, 404)
  })
})

describe('API: removals and reporting lines (12, 4)', () => {
  test('recovered CO2 is its own line and never reduces gross Scope 1; the run records the GWP basis', async () => {
    const s = await setup('Removals Org')
    const coal = await db.emissionSource.create({ data: { organizationId: s.org.id, facilityId: s.facility.id, name: 'Boiler', category: 'FUEL_COMBUSTION', activityCode: 'A-COAL' } })
    const rec = await db.emissionSource.create({ data: { organizationId: s.org.id, facilityId: s.facility.id, name: 'CO2 plant', category: 'REMOVAL', activityCode: 'A-CO2-REC' } })
    await approvedRecord(s, coal.id, '100', 't', '2025-04-01', '2025-04-30')
    await approvedRecord(s, rec.id, '500', 't', '2025-04-01', '2025-04-30', { meterReference: 'FM-12' })
    const r = (await s.admin.post('/api/calculations/runs', { reportingPeriodId: s.period.id })).body
    const scope1 = (await db.calculationResult.findFirst({ where: { runId: r.id, line: 'SCOPE1' } }))!.tCO2e!.toString()
    assert.equal(r.totals.SCOPE1.gross, scope1) // the removal is not subtracted
    assert.equal(Number(r.totals.REMOVALS.gross), 500) // WE-17
    assert.equal(r.gwpBasis, 'GWP-100')
  })
})
