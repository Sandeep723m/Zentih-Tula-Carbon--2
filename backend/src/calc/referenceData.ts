// Reference data from TC-DOM-002a Calculation Engine Workbook v0.1 (Scope 1-2 fill).
// Tabs 02 and 04 come verbatim from workbookData.ts (generated from the workbook); this file adds only
// how the app uses them: which emission source category an activity belongs to, which tab 06 formula
// calculates it, which tab 03 units it accepts (V-16), and its default NCV and density, which the extractor
// read into structured fields (ncvGJPerT, density, densityUnit) so nothing here parses free text.
import type { GhgCategory, PrismaClient, SourceCategory } from '../../generated/prisma/client.js'
import { dec } from './core/decimal.js'
import { WORKBOOK_ACTIVITY_TYPES, WORKBOOK_FACTORS } from './workbookData.js'

const MASS = ['kg', 't', 'short ton', 'Gg']
const ENERGY = ['MJ', 'GJ', 'TJ', 'kWh', 'MWh', 'MMBtu', 'therm']
const LIQUID = ['l', 'kl', 'm3', 'gal', 'bbl']
const GAS = ['SCM', 'scf', 'm3']
const DISTANCE = ['km', 'miles']
const UNIT_CODE: Record<string, string> = { tonne: 't', litre: 'l', kilolitre: 'kl' } // tab 02 "measured in" → tab 03 code

type WorkbookActivity = (typeof WORKBOOK_ACTIVITY_TYPES)[number]

// Tab 06 formula per activity: C-01 fossil and C-02 biomass stationary combustion, C-03 mobile, C-05
// fugitive, C-06 grid electricity (its market-based twin C-07 runs alongside, see registry.ts),
// C-21 steam/heat/cooling, C-04 process, C-08 removals. Only formulae in registry.ts are calculated.
// Agriculture rows (IPCC vol.4: livestock, fertiliser, rice, field burning) are Phase 2 (tab 01 S-17).
const agriculture = (a: WorkbookActivity) => a.category === 'Process' && /Vol4/.test(a.notes ?? '')
function formulaOf(a: WorkbookActivity): string | null {
  switch (a.category) {
    case 'Stationary combustion': return a.carbonOrigin === 'Biogenic' ? 'C-02' : 'C-01'
    case 'Mobile combustion': return 'C-03'
    case 'Fugitive': return 'C-05'
    case 'Purchased electricity': return a.code === 'A-PPA' ? null : 'C-06' // A-PPA is the instrument factor, not a consumption
    case 'Purchased steam / heat / cooling': return 'C-21'
    case 'Process': return agriculture(a) ? null : 'C-04'
    case 'Removal / recovery': return 'C-08'
    default: return null
  }
}

function sourceCategoryOf(a: WorkbookActivity): SourceCategory | null {
  switch (a.category) {
    case 'Stationary combustion':
    case 'Mobile combustion': return 'FUEL_COMBUSTION'
    case 'Fugitive': return 'FUGITIVE_GAS'
    case 'Purchased electricity': return a.code === 'A-PPA' ? null : 'PURCHASED_ELECTRICITY'
    case 'Purchased steam / heat / cooling': return 'PURCHASED_ENERGY'
    case 'Process': return agriculture(a) ? null : 'PROCESS'
    case 'Removal / recovery': return 'REMOVAL'
    default: return null
  }
}

// GHG category a source reports under, from its source category and (for fuel combustion) the workbook
// category of its activity type. Null when it cannot be told without guessing: fuel combustion with no
// activity, or an activity that does not belong to the source category. A Tenant Admin then confirms it.
export function ghgCategoryOf(source: SourceCategory, activityCategory?: string | null): GhgCategory | null {
  const fits = (expected: string) => activityCategory == null || activityCategory === expected
  switch (source) {
    case 'FUEL_COMBUSTION':
      if (activityCategory === 'Stationary combustion') return 'S1_STATIONARY'
      if (activityCategory === 'Mobile combustion') return 'S1_MOBILE'
      return null
    case 'FUGITIVE_GAS': return fits('Fugitive') ? 'S1_FUGITIVE' : null
    case 'PROCESS': return fits('Process') ? 'S1_PROCESS' : null
    case 'PURCHASED_ELECTRICITY': return fits('Purchased electricity') ? 'S2_ELECTRICITY' : null
    case 'PURCHASED_ENERGY': return fits('Purchased steam / heat / cooling') ? 'S2_HEAT_STEAM_COOLING' : null
    case 'REMOVAL': return fits('Removal / recovery') ? 'REMOVALS' : null
  }
}

// V-16 lists, from the tab 02 "measured in" unit and the tab 03 dimensions: solids by mass or energy;
// liquids also by volume; gases by gas volume; mobile fuels also by distance (C-15); CNG in kg or m3
// (C-03 conditions); refrigerants by mass; electricity in kWh, MWh or GJ (C-06).
function allowedUnitsOf(a: WorkbookActivity, measuredIn: string): string[] {
  const mobile = a.category === 'Mobile combustion'
  if (a.category === 'Stationary combustion' || mobile) {
    if (measuredIn === 't') return [...MASS, ...ENERGY]
    if (measuredIn === 'SCM') return [...GAS, ...MASS, ...ENERGY]
    if (measuredIn === 'kg') return [...MASS, ...GAS, ...ENERGY] // CNG
    return [...LIQUID, ...MASS, ...ENERGY, ...(mobile ? DISTANCE : [])]
  }
  if (a.category === 'Fugitive') return ['kg', 't']
  if (a.category === 'Purchased electricity') return ['kWh', 'MWh', 'GJ']
  if (a.category === 'Purchased steam / heat / cooling') return ['GJ', 'MJ', 'TJ', 'kWh', 'MWh', 'MMBtu', 'therm', 'ton-hour'] // C-21: to GJ
  if (a.category === 'Removal / recovery') return ['t', 'kg'] // tonnes of CO2 metered (C-08)
  if (a.category === 'Process' && !agriculture(a)) return /BOD/.test(measuredIn) ? ['kg BOD', 'kg N'] : ['t', 'kg', 'short ton', 'Gg'] // production, or effluent load
  return [] // not calculated: any unit is accepted
}

const WORKBOOK_SOURCE = 'IPCC 2006 vol.2 default'

export const ACTIVITY_TYPES = WORKBOOK_ACTIVITY_TYPES.map((a) => {
  const measuredIn = UNIT_CODE[a.measuredIn] ?? a.measuredIn
  return {
    code: a.code, name: a.name, scope: a.scope === 'Scope 2' ? 2 : 1, category: a.category,
    sourceCategory: sourceCategoryOf(a), measuredIn, allowedUnits: allowedUnitsOf(a, measuredIn),
    carbonOrigin: a.carbonOrigin, formulaCode: formulaOf(a),
    // C-23: TJ per tonne = GJ per tonne ÷ 1000. The published value and unit are kept beside it.
    defaultNcv: a.ncvGJPerT ? dec(a.ncvGJPerT).div(1000).toString() : null,
    defaultNcvPublished: a.ncvGJPerT ? `${a.ncvGJPerT} GJ/t` : null,
    defaultNcvSource: a.ncvGJPerT ? WORKBOOK_SOURCE : null,
    defaultDensity: a.density ?? null,
    defaultDensityUnit: a.densityUnit ?? null,
    defaultDensitySource: a.density ? `${WORKBOOK_SOURCE}, indicative` : null,
    notes: a.notes,
  }
})

// Tab 03, every row with a fixed multiplier (property-dependent rows such as VOL->MASS are formulae, not units).
export const UNITS = [
  ['kg', 'kilogram', 'Mass', 'kg', '1'],
  ['t', 'tonne (metric)', 'Mass', 'kg', '1000'],
  ['short ton', 'short ton (US)', 'Mass', 'kg', '907.18474'],
  ['Gg', 'gigagram', 'Mass', 'kg', '1000000'],
  ['l', 'litre', 'Volume', 'm3', '0.001'],
  ['kl', 'kilolitre', 'Volume', 'm3', '1'],
  ['m3', 'cubic metre', 'Volume', 'm3', '1'],
  ['gal', 'US gallon', 'Volume', 'm3', '0.003785411784'],
  ['bbl', 'barrel (oil)', 'Volume', 'm3', '0.158987294928'],
  ['SCM', 'standard cubic metre', 'Volume (gas)', 'm3', '1'],
  ['scf', 'standard cubic foot', 'Volume (gas)', 'm3', '0.0283168466'],
  ['MJ', 'megajoule', 'Energy', 'MJ', '1'],
  ['kWh', 'kilowatt hour', 'Energy', 'MJ', '3.6'],
  ['MWh', 'megawatt hour', 'Energy', 'MJ', '3600'],
  ['GJ', 'gigajoule', 'Energy', 'MJ', '1000'],
  ['TJ', 'terajoule', 'Energy', 'MJ', '1000000'],
  ['kcal', 'kilocalorie', 'Energy', 'MJ', '0.0041868'],
  ['MMBtu', 'million British thermal units', 'Energy', 'MJ', '1055.056'],
  ['therm', 'therm (US)', 'Energy', 'MJ', '105.5056'],
  ['ton-hour', 'ton of refrigeration hour', 'Energy', 'MJ', '12.66067'],
  ['km', 'kilometre', 'Distance', 'km', '1'],
  ['miles', 'mile', 'Distance', 'km', '1.609344'],
  ['head', 'animal head count', 'Count', 'head', '1'],
  ['ha', 'hectare', 'Area', 'ha', '1'],
  ['kg BOD', 'kilogram biochemical oxygen demand', 'Pollutant load', 'kg BOD', '1'],
  ['kg N', 'kilogram nitrogen', 'Nutrient load', 'kg N', '1'],
] as const

// Grid regions offered in boundary setup. Names are the values facilities already store.
// Indian regional grids fall back to the all-India factor, flagged for review (tab 05 rule 9),
// because the workbook has no regional CEA values yet (EF-0339 "not retrieved").
export const GRID_REGIONS = [
  ['IN-ALL', 'India - National Average', 'India', null],
  ['IN-N', 'India - Northern Grid', 'India', 'IN-ALL'],
  ['IN-W', 'India - Western Grid', 'India', 'IN-ALL'],
  ['IN-S', 'India - Southern Grid', 'India', 'IN-ALL'],
  ['IN-E', 'India - Eastern Grid', 'India', 'IN-ALL'],
  ['IN-NE', 'India - North-Eastern Grid', 'India', 'IN-ALL'],
  ['UK-DEFRA', 'UK - DEFRA', 'United Kingdom', null],
  ['US-CAMX', 'eGRID - CAMX', 'United States', null],
  ['US-ERCT', 'eGRID - ERCT', 'United States', null],
  ['US-NYUP', 'eGRID - NYUP', 'United States', null],
  ['US-RFCE', 'eGRID - RFCE', 'United States', null],
  ['US-SRMW', 'eGRID - SRMW', 'United States', null],
  ['KE', 'Kenya - National Grid', 'Kenya', null],
  ['ZA', 'South Africa - National Grid', 'South Africa', null],
  ['NG', 'Nigeria - National Grid', 'Nigeria', null],
  ['EG', 'Egypt - National Grid', 'Egypt', null],
  ['IEA', 'IEA - Country Average', 'Various', null],
] as const

// Tab 04 rows with a value. Blank rows (EF-0030 generic refrigerant, EF-0339 regional grid, EF-0341
// residual mix, EF-0342..0344 steam/heat/cooling, …) are not loaded. GWP rows ("ALL (C-09)") apply to
// every activity, so they have no activity code.
// EF-0020's geography column reads "NEWNE grid" but its note and worked example WE-14 use it as the
// all-India weighted average; the workbook says the words win, so it is filed under IN-ALL.
const GRID_FACTOR_REGION: Record<string, { id: string; regionCode: string }> = {
  'EF-0020': { id: '00000000-0000-4000-8000-000000000020', regionCode: 'IN-ALL' },
  'EF-0338': { id: '00000000-0000-4000-8000-000000000338', regionCode: 'IN-ALL' },
}

export interface SeedFactor {
  id?: string; code: string; activityCode: string | null; gas: string; value: string; numeratorUnit: string; denominatorUnit: string
  carbonOrigin: string; source: string; sourceVersion: string; validFrom: string; validTo: string | null; regionCode: string | null
  geography: string; tier: string; notes: string | null; gwpSet: string | null; gwpBasis: string | null
}
const gwpSetOf = (sourceVersion: string) => (/^AR6/.test(sourceVersion) ? 'AR6' : /^AR5/.test(sourceVersion) ? 'AR5' : null)

export const SEED_FACTORS: SeedFactor[] = WORKBOOK_FACTORS.filter((f) => f.value != null).map((f) => ({
  ...(GRID_FACTOR_REGION[f.code] ? { id: GRID_FACTOR_REGION[f.code].id } : {}),
  code: f.code,
  activityCode: f.activityCode === 'ALL (C-09)' ? null : f.activityCode,
  gas: f.gas ?? 'CO2e',
  value: f.value as string,
  numeratorUnit: f.numeratorUnit ?? '',
  denominatorUnit: f.denominatorUnit ?? '',
  carbonOrigin: f.carbonOrigin ?? 'Fossil',
  source: f.source ?? '',
  sourceVersion: f.sourceVersion ?? '',
  validFrom: f.validFrom as string,
  validTo: f.validTo && /^\d{4}-\d{2}-\d{2}$/.test(f.validTo) ? f.validTo : null, // "open-ended" → null
  regionCode: GRID_FACTOR_REGION[f.code]?.regionCode ?? null,
  geography: f.geography ?? '',
  tier: f.tier ?? 'n/a',
  notes: f.notes ?? null,
  gwpSet: gwpSetOf(f.sourceVersion ?? ''),
  gwpBasis: gwpSetOf(f.sourceVersion ?? '') ? 'GWP-100' : null,
}))

// AR5 GWPs of refrigerants are quoted only in the notes of their AR6 rows ("AR5 value 1923.5"); they
// become rows of their own so an AR5 report (J-09) uses the workbook's figure, never a guessed one.
for (const w of WORKBOOK_FACTORS) {
  const f = SEED_FACTORS.find((x) => x.code === w.code)
  if (f && w.ar5Value && f.activityCode) SEED_FACTORS.push({ ...f, id: undefined, code: `${f.code}-AR5`, value: w.ar5Value, sourceVersion: `AR5 (value quoted in the ${f.code} note)`, gwpSet: 'AR5', notes: `AR5 GWP-100 for ${f.activityCode}.` })
}

// Idempotent. Definitions are refreshed, except each activity's formula and accepted units, which a Super
// Admin may have changed (Activities & Formulas page; "Restore workbook default" brings these back).
// Factors are only ever inserted, never changed (tab 04).
export async function seedReferenceData(db: PrismaClient) {
  const known = new Set<string>(ACTIVITY_TYPES.map((a) => a.code))
  for (const a of ACTIVITY_TYPES) {
    const { formulaCode: _formula, allowedUnits: _units, ...definition } = a
    await db.activityType.upsert({ where: { code: a.code }, update: definition, create: a })
  }
  for (const [code, name, dimension, baseUnit, toBase] of UNITS) {
    await db.unit.upsert({ where: { code }, update: { name, dimension, baseUnit, toBase }, create: { code, name, dimension, baseUnit, toBase } })
  }
  const ordered = GRID_REGIONS.map((r, sortOrder) => ({ code: r[0], name: r[1], country: r[2], fallbackCode: r[3], sortOrder }))
  for (const r of ordered) await db.gridRegion.upsert({ where: { code: r.code }, update: r, create: r })
  const existing = new Set((await db.emissionFactor.findMany({ select: { code: true } })).map((f) => f.code))
  const missing = SEED_FACTORS.filter((f) => !existing.has(f.code) && (!f.activityCode || known.has(f.activityCode)))
  await db.emissionFactor.createMany({
    data: missing.map((f) => ({ ...f, status: 'APPROVED' as const, validFrom: new Date(f.validFrom), validTo: f.validTo ? new Date(f.validTo) : null })), // published platform library
  })
  // Databases set up before the structured GWP set (MySQL has no migrations): fill it on the seeded rows only.
  for (const set of ['AR6', 'AR5']) {
    await db.emissionFactor.updateMany({ where: { gwpSet: null, createdById: null, sourceVersion: { startsWith: set } }, data: { gwpSet: set, gwpBasis: 'GWP-100' } })
  }
}
