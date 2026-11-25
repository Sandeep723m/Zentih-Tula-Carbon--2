// Workbook TC-DOM-002a tab 06, C-21: Scope 2 purchased steam, heat or cooling.
//   E = Q_GJ × EF_supplier / 1000   (EF in kg CO2e per GJ; cooling ton-hours to GJ by tab 03, × 0.01266067)
// No generic factor exists (tab 04 EF-0342..0344 blank, tab 05 rule 11): the supplier's factor is entered on
// the record with its disclosure, or added once as the organisation's own factor in the library (never a shared
// one); without either the record is blocked (V-19). Rule 11 needs a confirmation.
import { z } from 'zod'
import { dec } from '../core/decimal.js'
import { selectFactor } from '../core/factors.js'
import { block, blocked, isoDay, warn, type Method, type Outcome, type RecordInput, type Reference } from '../core/types.js'
import { allowedUnitsOf, resolveUnit, TO_TONNES, toUnit } from '../core/units.js'

const CODE = 'C-21'

const parameters = z.object({
  supplierFactor: z.union([z.number(), z.string()]).transform((v) => String(v).trim())
    .pipe(z.string().regex(/^\d{1,9}(\.\d{1,9})?$/, 'Supplier factor must be a number (kg CO2e per GJ)')).optional(),
  supplierDisclosure: z.string().trim().min(1).max(200).optional(),
}).strict()

function calculate(rec: RecordInput, ref: Reference): Outcome {
  const p = rec.parameters as z.infer<typeof parameters>
  const inputs: Record<string, unknown> = { quantity: rec.quantity, unitEntered: rec.unit, periodStart: isoDay(rec.periodStart), ...p }
  const resolved = resolveUnit(rec.unit, allowedUnitsOf(ref.activityTypes), ref.units)
  if ('issue' in resolved) return blocked(CODE, inputs, [resolved.issue])
  inputs.unit = resolved.unit.code
  if (!p.supplierFactor) {
    // The organisation's own supplier factor for this activity, in force at the period start (rules 4 and 14).
    const own = ref.factors.filter((f) => f.organizationId)
    const pick = selectFactor(own, ref.activityTypes.map((a) => a.code), null, rec.periodStart)
    const f = pick.factor
    const converted = f && toUnit(rec.quantity, resolved.unit, f.denominatorUnit, ref.units)
    const toTonnes = f && TO_TONNES[f.numeratorUnit.replace(/\s+/g, '')]
    if (!f) return blocked(CODE, inputs, [block('V-19', 'Supplier-specific emission factor required. Enter the supplier factor (kg CO2e per GJ) on this record and attach the disclosure, or add it as your organisation\'s own factor in the Emission Factors library.')])
    if (!converted || !toTonnes) return blocked(CODE, inputs, [block('V-01', `Your supplier factor ${f.code} is per ${f.denominatorUnit}, which ${resolved.unit.code} cannot be converted to.`)])
    inputs.convertedTo = converted.to.code
    inputs.convertedQuantity = converted.amount.toString()
    inputs.conversionFactor = converted.factor.toString()
    return {
      formulaCode: CODE,
      status: 'CALCULATED',
      inputs,
      factor: f,
      selection: { rule: 'Supplier-specific factor (organisation library)', factorCode: f.code, value: f.value.toString(), unit: `${f.numeratorUnit}/${f.denominatorUnit}`, source: f.source },
      tCO2e: converted.amount.mul(dec(f.value.toString())).mul(dec(toTonnes)),
      issues: [warn('R-11', `Your organisation's supplier factor ${f.code} (${f.value} ${f.numeratorUnit} per ${f.denominatorUnit}, ${f.source}) was used. Confirm it covers this supplier and period.`)],
      needsConfirmation: true,
    }
  }
  const gj = toUnit(rec.quantity, resolved.unit, 'GJ', ref.units)!
  inputs.convertedTo = 'GJ'
  inputs.convertedQuantity = gj.amount.toString()
  inputs.conversionFactor = gj.factor.toString()
  return {
    formulaCode: CODE,
    status: 'CALCULATED',
    inputs,
    factor: null, // supplier-specific, stored in inputs
    selection: { rule: 'Supplier-specific factor from the invoice or disclosure', supplierFactor: p.supplierFactor, unit: 'kg CO2e/GJ', disclosure: p.supplierDisclosure ?? null },
    tCO2e: gj.amount.mul(dec(p.supplierFactor)).div(1000),
    issues: [warn('R-11', `Check the supplier factor ${p.supplierFactor} kg CO2e/GJ${p.supplierDisclosure ? ` (${p.supplierDisclosure})` : ''} matches the supplier's statement for this period, and attach that statement.`)],
    needsConfirmation: true,
  }
}

export const c21: Method = {
  formulaCode: CODE,
  title: 'Scope 2 — purchased steam, heat or cooling',
  scope: 2,
  line: 'SCOPE2_HEAT',
  parameters,
  fields: [
    { name: 'supplierFactor', label: 'Supplier emission factor, kg CO2e per GJ', kind: 'decimal', hint: 'From the supplier invoice or disclosure. There is no default.' },
    { name: 'supplierDisclosure', label: 'Supplier disclosure reference', kind: 'text', hint: 'e.g. "Steam supplier sustainability statement 2024"' },
  ],
  calculate,
}
