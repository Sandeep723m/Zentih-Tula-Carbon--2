// Workbook TC-DOM-002a tab 06, C-04: Scope 1 process emissions (and on-site waste treatment, S-16).
//   E = A × EF_process × (1 − R)     R = recovered or abated fraction, evidenced by metering
// A is production (tonnes) or effluent load (kg BOD, kg N). Factors per tab 04: tCO2 per tonne, or kg CH4 /
// kg N2O per unit (to CO2e by C-09), or kg N2O-N (× 44/28, as the tab 04 notes say). Where an activity has
// several factors (lime type, nitric acid plant…), the record names the one that applies. Wastewater CH4 is
// multiplied by the MCF of the treatment system (EF-0322 note), entered on the record.
// Rule 12: process defaults are coarse and must be accepted by a person; fuel burned for process heat is
// counted in C-01, not here (G-09).
import { z } from 'zod'
import { dec, ZERO, type Dec } from '../core/decimal.js'
import { selectGwp, toCO2eTonnes } from '../core/factors.js'
import { block, blocked, isoDay, warn, type Issue, type Method, type Outcome, type RecordInput, type Reference } from '../core/types.js'
import { allowedUnitsOf, resolveUnit, toUnit } from '../core/units.js'

const CODE = 'C-04'
const fraction = (what: string) => z.union([z.number(), z.string()]).transform((v) => String(v).trim())
  .pipe(z.string().regex(/^(0(\.\d{1,6})?|1(\.0{1,6})?)$/, `${what} is a fraction between 0 and 1`))

const parameters = z.object({
  factorCode: z.string().trim().max(20).optional(),
  abatedFraction: fraction('Abated fraction').optional(),
  mcf: fraction('MCF').optional(),
}).strict()

// Tab 04 denominators → tab 03 units ("tonne clinker" is a tonne).
const perUnit = (denominator: string) => (/^tonne/.test(denominator) ? 't' : denominator.replace(/ applied$/, ''))

function calculate(rec: RecordInput, ref: Reference): Outcome {
  const p = rec.parameters as z.infer<typeof parameters>
  const inputs: Record<string, unknown> = { quantity: rec.quantity, unitEntered: rec.unit, periodStart: isoDay(rec.periodStart), ...p }
  const activity = ref.activityTypes.length === 1 ? ref.activityTypes[0] : undefined
  if (!activity) return blocked(CODE, inputs, [block('SRC-01', 'Select the process on this emission source (Emission Sources page).')])
  inputs.activityCode = activity.code
  const resolved = resolveUnit(rec.unit, allowedUnitsOf([activity]), ref.units)
  if ('issue' in resolved) return blocked(CODE, inputs, [resolved.issue])
  inputs.unit = resolved.unit.code

  const valid = (f: (typeof ref.factors)[number]) => f.validFrom <= rec.periodStart && (!f.validTo || f.validTo >= rec.periodStart)
  const candidates = ref.factors.filter((f) => f.activityCode === activity.code && valid(f))
  if (!candidates.length) return blocked(CODE, inputs, [block('V-03', `No process factor is loaded for ${activity.name}${activity.code === 'A-PR-SOLID-WASTE-DISPO' ? ': landfill needs the first-order-decay model inputs (Q-06)' : ''}.`)])
  const factor = p.factorCode ? candidates.find((f) => f.code === p.factorCode) : candidates.length === 1 ? candidates[0] : undefined
  if (!factor) return blocked(CODE, inputs, [block('C-04', `Select the process type in "Which factor applies" under Calculation details: ${candidates.map((f) => `${f.code} (${f.value} ${f.numeratorUnit} per ${f.denominatorUnit})`).join('; ')}.`)])

  const amount = toUnit(rec.quantity, resolved.unit, perUnit(factor.denominatorUnit), ref.units)
  if (!amount) return blocked(CODE, inputs, [block('V-16', `${factor.code} is per ${factor.denominatorUnit}; enter the quantity in ${perUnit(factor.denominatorUnit)}.`)])
  const keep = dec(1).sub(dec(p.abatedFraction ?? '0'))
  let base = amount.amount.mul(dec(factor.value.toString())).mul(keep)
  const issues: Issue[] = [warn('R-12', 'A standard international (IPCC) factor is used for this process. If your plant has its own measured value (e.g. from a lab analysis), ask your administrator to use it instead.')]
  if (p.abatedFraction && Number(p.abatedFraction) > 0) issues.push(warn('C-04', `${Number(p.abatedFraction) * 100}% abated or recovered: confirm the metering evidence is attached.`))
  if (factor.denominatorUnit === 'kg BOD') {
    if (!p.mcf) return blocked(CODE, inputs, [block('C-04', 'Enter the methane correction factor (MCF) of your treatment system (a number between 0 and 1, from the plant design or operator).')])
    base = base.mul(dec(p.mcf))
  }

  let tCO2e: Dec
  let gases: Record<string, string>
  const gas = factor.gas
  if (factor.numeratorUnit === 'tCO2') {
    tCO2e = base
    gases = { CO2: base.mul(1000).toString() }
  } else if (/^kg (CH4|N2O)/.test(factor.numeratorUnit)) {
    const kg = factor.numeratorUnit === 'kg N2O-N' ? base.mul(44).div(28) : base // N2O-N to N2O: × 44/28 (tab 04 note)
    const gwp = selectGwp(ref.factors, { activityCode: null, gas, origin: 'Fossil' }, ref.gwpSet)
    if (!gwp) return blocked(CODE, inputs, [block('V-03', `No ${ref.gwpSet} GWP is loaded for ${gas}.`)])
    tCO2e = toCO2eTonnes({ [gas]: kg }, { [gas]: gwp.value })
    gases = { [gas]: kg.toString() }
    inputs.gwp = `${gwp.code} ${gwp.value}`
  } else {
    return blocked(CODE, inputs, [block('V-03', `Factor ${factor.code} is in ${factor.numeratorUnit}, which the process formula does not handle.`)])
  }
  return {
    formulaCode: CODE,
    status: 'CALCULATED',
    inputs: { ...inputs, convertedQuantity: amount.amount.toString(), convertedTo: perUnit(factor.denominatorUnit) },
    factor,
    selection: { rule: 'IPCC default process factor (Tier 1)', factorCode: factor.code, otherCandidates: candidates.filter((f) => f !== factor).map((f) => f.code), abatedFraction: p.abatedFraction ?? '0' },
    tCO2e: tCO2e.lt(ZERO) ? ZERO : tCO2e,
    gases,
    issues,
    needsConfirmation: true,
  }
}

export const c04: Method = {
  formulaCode: CODE,
  title: 'Scope 1 — process emissions',
  scope: 1,
  line: 'SCOPE1',
  parameters,
  fields: [
    { name: 'factorCode', label: 'Which factor applies', kind: 'select', options: [], hint: 'The process type, as listed in the factor library (e.g. high-calcium or dolomitic lime).' },
    { name: 'abatedFraction', label: 'Recovered or abated fraction (0–1, optional)', kind: 'decimal', hint: 'Only with metering evidence.' },
    { name: 'mcf', label: 'Methane correction factor of the treatment system (0–1)', kind: 'decimal', hint: 'Wastewater (kg BOD) only.' },
  ],
  calculate,
}
