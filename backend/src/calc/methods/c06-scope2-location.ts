// Workbook TC-DOM-002a tab 06, C-06: Scope 2 purchased electricity, location-based.
//   E_loc = MWh × EF_grid   (tCO2e; MWh from kWh × 0.001 or GJ ÷ 3.6)
import { z } from 'zod'
import { dec } from '../core/decimal.js'
import { selectGridFactor } from '../core/factors.js'
import { block, blocked, isoDay, type Method, type Outcome, type RecordInput, type Reference } from '../core/types.js'
import { allowedUnitsOf, resolveUnit, toUnit, TO_TONNES } from '../core/units.js'

const CODE = 'C-06'

// Shared with C-07: the consumption in the grid factor's unit, and the grid factor (tab 05 rule 9).
export function gridBasis(code: string, rec: RecordInput, ref: Reference) {
  const inputs: Record<string, unknown> = { quantity: rec.quantity, unitEntered: rec.unit, gridLocation: rec.gridLocation, periodStart: isoDay(rec.periodStart) }

  const resolved = resolveUnit(rec.unit, allowedUnitsOf(ref.activityTypes), ref.units)
  if ('issue' in resolved) return { outcome: blocked(code, inputs, [resolved.issue]) }
  inputs.unit = resolved.unit.code

  const pick = selectGridFactor(rec.gridLocation, ref.regions, ref.factors, ref.activityTypes.map((a) => a.code), rec.periodStart)
  if (pick.region) inputs.regionAsked = pick.region.code
  if (!pick.ok) return { outcome: blocked(code, inputs, [pick.issue]) }
  const { factor } = pick
  inputs.regionUsed = pick.used.code

  const converted = toUnit(rec.quantity, resolved.unit, factor.denominatorUnit, ref.units)
  if (!converted) return { outcome: blocked(code, inputs, [...pick.issues, block('V-01', `Factor ${factor.code} is per ${factor.denominatorUnit}, which ${resolved.unit.code} cannot be converted to.`)]) }
  const toTonnes = TO_TONNES[factor.numeratorUnit]
  if (!toTonnes) return { outcome: blocked(code, inputs, [...pick.issues, block('V-03', `Factor ${factor.code} is in ${factor.numeratorUnit}; only tCO2e and kgCO2e factors are supported.`)]) }

  inputs.convertedTo = converted.to.code
  inputs.conversionFactor = converted.factor.toString()
  inputs.convertedQuantity = converted.amount.toString()
  const selection = {
    rule: pick.used === pick.region ? 'CEA factor for the grid region, version frozen for the reporting year' : 'Fallback: all-India factor, flagged for review',
    factorCode: factor.code, regionAsked: pick.region.code, regionUsed: pick.used.code, fallback: pick.used !== pick.region,
    otherCandidates: pick.others.map((f) => f.code), newerVersions: pick.newer.map((f) => f.code),
  }
  return { inputs, pick, factor, amount: converted.amount, toTonnes: dec(toTonnes), selection }
}

function calculate(rec: RecordInput, ref: Reference): Outcome {
  const g = gridBasis(CODE, rec, ref)
  if (g.outcome) return g.outcome
  return {
    formulaCode: CODE,
    status: 'CALCULATED',
    inputs: g.inputs,
    factor: g.factor,
    selection: g.selection,
    tCO2e: g.amount.mul(dec(g.factor.value.toString())).mul(g.toTonnes),
    issues: g.pick.issues,
    needsConfirmation: g.pick.issues.some((i) => i.severity === 'WARN'),
  }
}

export const c06: Method = {
  formulaCode: CODE,
  title: 'Scope 2 — purchased electricity, location-based',
  scope: 2,
  line: 'SCOPE2_LOCATION',
  parameters: z.object({}).strict(), // quantity and unit are all it needs
  fields: [],
  calculate,
}
