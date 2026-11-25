// Workbook TC-DOM-002a tab 06, C-05: Scope 1 fugitive emissions (refrigerants, SF6, other gases).
//   Mass balance (C-18, preferred): L = P + max(0, D − Rec)     P = quantity entered (top-up)
//   Screening (C-17):               L = Charge × r             Charge = quantity entered
//   E = L × GWP / 1000   (L in kg, GWP in tCO2e per tonne of gas from tab 04, AR6; blends pre-computed, C-19)
import { z } from 'zod'
import { dec, ZERO } from '../core/decimal.js'
import { selectGwp } from '../core/factors.js'
import { block, blocked, isoDay, warn, type Issue, type Method, type Outcome, type RecordInput, type Reference } from '../core/types.js'
import { allowedUnitsOf, resolveUnit, toUnit } from '../core/units.js'

const CODE = 'C-05'

const kg = (what: string) => z.union([z.number(), z.string()]).transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,12}(\.\d{1,6})?$/, `${what} must be a number of kg`))

const parameters = z.object({
  method: z.enum(['MASS_BALANCE', 'SCREENING']).optional(), // default mass balance
  disposedKg: kg('Gas disposed').optional(),
  recoveredKg: kg('Gas recovered').optional(),
  leakRate: z.union([z.number(), z.string()]).transform((v) => String(v).trim())
    .pipe(z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/, 'Leak rate is a fraction between 0 and 1, e.g. 0.1 for 10%')).optional(),
}).strict()
type Params = z.infer<typeof parameters>

function calculate(rec: RecordInput, ref: Reference): Outcome {
  const p = rec.parameters as Params
  const method = p.method ?? 'MASS_BALANCE'
  const inputs: Record<string, unknown> = { quantity: rec.quantity, unitEntered: rec.unit, periodStart: isoDay(rec.periodStart), method, ...p }
  const activity = ref.activityTypes.length === 1 ? ref.activityTypes[0] : undefined
  if (!activity) return blocked(CODE, inputs, [block('SRC-01', 'Select the gas on this emission source (Emission Sources page) so the right GWP applies.')])
  inputs.activityCode = activity.code

  const resolved = resolveUnit(rec.unit, allowedUnitsOf([activity]), ref.units)
  if ('issue' in resolved) return blocked(CODE, inputs, [resolved.issue])
  inputs.unit = resolved.unit.code
  const quantityKg = toUnit(rec.quantity, resolved.unit, 'kg', ref.units)!.amount

  const issues: Issue[] = []
  let leakKg
  if (method === 'MASS_BALANCE') {
    const disposed = dec(p.disposedKg ?? '0')
    const recovered = dec(p.recoveredKg ?? '0')
    if (recovered.gt(disposed)) return blocked(CODE, inputs, [block('V-15', 'Recovered gas cannot exceed disposed gas.')])
    const unrecovered = disposed.sub(recovered)
    leakKg = quantityKg.add(unrecovered.gt(ZERO) ? unrecovered : ZERO) // C-18
  } else {
    if (p.leakRate == null) return blocked(CODE, inputs, [block('C-17', 'Enter the annual leak rate for the screening method.')])
    leakKg = quantityKg.mul(dec(p.leakRate)) // C-17
    issues.push(warn('J-07', 'You used an estimated leak rate. If you have service records of refrigerant added, recovered or disposed, use the Mass balance method instead for a more accurate result.'))
  }
  inputs.leakKg = leakKg.toString()

  // Rule 8: the GWP of that gas from the report's set; the generic A-REFR row has none, so it blocks.
  const gwp = selectGwp(ref.factors, { activityCode: activity.code, gas: 'CO2e' }, ref.gwpSet)
  if (!gwp || gwp.numeratorUnit !== 'tCO2e' || gwp.denominatorUnit !== 'tonne of gas') {
    return blocked(CODE, inputs, [block('V-03', `No ${ref.gwpSet} GWP is loaded for ${activity.name}. Use the gas-specific activity (e.g. R-410A) on the emission source.`)])
  }
  return {
    formulaCode: CODE,
    status: 'CALCULATED',
    inputs,
    factor: gwp,
    selection: { rule: `GWP-100 of the gas, ${ref.gwpSet}`, gwp: { code: gwp.code, value: gwp.value.toString(), set: ref.gwpSet } },
    tCO2e: leakKg.div(1000).mul(dec(gwp.value.toString())),
    gases: { [activity.code]: leakKg.toString() },
    issues,
    needsConfirmation: issues.length > 0,
  }
}

export const c05: Method = {
  formulaCode: CODE,
  title: 'Scope 1 — fugitive emissions (refrigerants and other gases)',
  scope: 1,
  line: 'SCOPE1',
  parameters,
  fields: [
    { name: 'method', label: 'Method', kind: 'select', options: [{ value: 'MASS_BALANCE', label: 'Mass balance: quantity is gas topped up' }, { value: 'SCREENING', label: 'Screening: quantity is installed charge' }] },
    { name: 'disposedKg', label: 'Gas disposed, kg (mass balance)', kind: 'decimal' },
    { name: 'recoveredKg', label: 'Gas recovered, kg (mass balance)', kind: 'decimal' },
    { name: 'leakRate', label: 'Annual leak rate, fraction (screening)', kind: 'decimal', hint: 'e.g. 0.1 for 10%. An expert judgement.' },
  ],
  calculate,
}
