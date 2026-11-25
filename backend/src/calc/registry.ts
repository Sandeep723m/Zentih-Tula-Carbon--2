// The calculation methods the engine knows, keyed by workbook tab 06 Calc ID.
// To add a calculation: write methods/<id>.ts implementing Method, add it to BY_FORMULA, make sure its
// activity types carry that formulaCode (referenceData.ts), and add its tab 07 examples to the tests.
import { z } from 'zod'
import { c01, c02, c03 } from './methods/combustion.js'
import { c04 } from './methods/c04-process.js'
import { c05 } from './methods/c05-fugitive.js'
import { c08 } from './methods/c08-removal.js'
import { c21 } from './methods/c21-purchased-heat.js'
import { c06 } from './methods/c06-scope2-location.js'
import { c07 } from './methods/c07-scope2-market.js'
import type { ActivityTypeRow, Method, Outcome, RecordInput, Reference } from './core/types.js'

export const ENGINE_VERSION = 'TC-DOM-002a v0.1' // the specification implemented

// The methods run for an activity's formula. Grid electricity gives both Scope 2 figures, C-06 and
// C-07, which are reported side by side and never added together (tab 09 G-07).
const BY_FORMULA: Record<string, Method[]> = {
  'C-01': [c01], 'C-02': [c02], 'C-03': [c03], 'C-04': [c04], 'C-05': [c05], 'C-06': [c06, c07], 'C-08': [c08], 'C-21': [c21],
}
export const METHODS: Method[] = [c01, c02, c03, c04, c05, c06, c07, c08, c21]

// Each formula as people read it (workbook tab 06), the unit dimensions its code can convert, and the
// formulas an activity may be switched to without its records' inputs becoming invalid. C-01, C-02 and C-03
// share one calculator and one set of inputs; every other formula takes its own inputs, so it has no swap.
export const FORMULA_INFO: Record<string, { equation: string[]; dimensions: string[] }> = {
  'C-01': { equation: ['Fuel (t) = quantity converted to tonnes (litres × density, or a mass unit)', 'Energy (TJ) = fuel (t) × net calorific value (TJ/t)', 'Each gas (kg) = energy (TJ) × emission factor (kg/TJ) for CO₂, CH₄ and N₂O', 'tCO₂e = (CO₂ + CH₄ × GWP + N₂O × GWP) ÷ 1000'], dimensions: ['Mass', 'Energy', 'Volume', 'Volume (gas)'] },
  'C-02': { equation: ['Same steps as C-01', 'Biomass CO₂ is reported separately (memo line); only CH₄ and N₂O count in Scope 1'], dimensions: ['Mass', 'Energy', 'Volume', 'Volume (gas)'] },
  'C-03': { equation: ['Same steps as C-01, with the vehicle CH₄ and N₂O factors', 'If a distance is entered: fuel (litres) = distance (km) ÷ fuel economy (km/l) first'], dimensions: ['Mass', 'Energy', 'Volume', 'Volume (gas)', 'Distance'] },
  'C-04': { equation: ['Emissions = production × process emission factor × (1 − recovered or abated fraction)', 'Methane and nitrous oxide factors are turned into CO₂e with their GWP'], dimensions: ['Mass'] },
  'C-05': { equation: ['Mass balance: leak (kg) = gas topped up + max(0, gas disposed − gas recovered)', 'Screening: leak (kg) = installed charge × annual leak rate', 'tCO₂e = leak (kg) × GWP of the gas ÷ 1000'], dimensions: ['Mass'] },
  'C-06': { equation: ['Location-based: tCO₂e = electricity (MWh) × grid emission factor', 'Market-based (runs alongside): tCO₂e = (MWh − certificate MWh) × residual factor + certificate MWh × certificate factor'], dimensions: ['Energy'] },
  'C-08': { equation: ['Removal (t CO₂) = metered tonnes of CO₂ recovered', 'Reported as its own line, never subtracted from emissions'], dimensions: ['Mass'] },
  'C-21': { equation: ['Energy (GJ) = quantity converted to GJ', 'tCO₂e = energy (GJ) × supplier emission factor (kg CO₂e/GJ) ÷ 1000'], dimensions: ['Energy'] },
}
// Formulas an activity may use, given the formula the workbook assigns it and its carbon origin.
export function formulaChoices(workbookFormula: string | null, carbonOrigin: string): string[] {
  if (!workbookFormula || !isCalculable(workbookFormula)) return []
  if (['C-01', 'C-02', 'C-03'].includes(workbookFormula)) return carbonOrigin === 'Biogenic' ? ['C-02', 'C-03'] : ['C-01', 'C-03']
  return [workbookFormula]
}

export const methodsFor = (formulaCode: string | null | undefined): Method[] => (formulaCode && BY_FORMULA[formulaCode]) || []
export const isCalculable = (formulaCode: string | null | undefined) => methodsFor(formulaCode).length > 0
export const methodByCode = (formulaCode: string) => METHODS.find((m) => m.formulaCode === formulaCode) ?? null

// Extra inputs a record of this formula takes: every input its methods declare, strictly.
export function parametersFor(formulaCode: string | null | undefined) {
  const methods = methodsFor(formulaCode)
  return {
    schema: z.object(Object.assign({}, ...methods.map((m) => m.parameters.shape))).strict(),
    fields: methods.flatMap((m) => m.fields),
  }
}

// The activity a record of this source is calculated as: the source's own activity (fuel, gas, grid), or,
// for a source with none chosen, every calculable activity of its category when they share one formula
// (grid electricity). Fuels and gases without one get no types, and their method blocks (SRC-01).
// Null = not calculable yet (e.g. steam, process).
export function resolveActivity<T extends ActivityTypeRow & { sourceCategory: string | null }>(
  source: { category: string; activityCode: string | null }, types: T[],
): { types: T[]; formulaCode: string } | null {
  if (source.activityCode) {
    const own = types.find((t) => t.code === source.activityCode)
    return own && isCalculable(own.formulaCode) ? { types: [own], formulaCode: own.formulaCode! } : null
  }
  const candidates = types.filter((t) => t.sourceCategory === source.category && isCalculable(t.formulaCode))
  if (!candidates.length) return null
  const formulas = [...new Set(candidates.map((t) => t.formulaCode!))]
  return { types: formulas.length === 1 ? candidates : [], formulaCode: formulas[0] }
}

// Every method of the formula, on one record. `ref.activityTypes` are the record's resolved types.
export function calculateAll(rec: RecordInput, ref: Reference, formulaCode: string): Array<{ method: Method; outcome: Outcome }> {
  const methods = methodsFor(formulaCode)
  if (!methods.length) throw new Error(`No calculation method for formula ${formulaCode}`)
  return methods.map((method) => ({ method, outcome: method.calculate(rec, ref) }))
}

// One method by its own Calc ID (tests, worked examples).
export function calculate(rec: RecordInput, ref: Reference, formulaCode = ref.activityTypes[0]?.formulaCode ?? ''): Outcome {
  const method = methodByCode(formulaCode)
  if (!method) throw new Error(`No calculation method for formula ${formulaCode}`)
  return method.calculate(rec, ref)
}
