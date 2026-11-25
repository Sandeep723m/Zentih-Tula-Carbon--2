// Workbook TC-DOM-002a tab 06, C-08: removals / recovered CO2.
//   Removal = Q_CO2,rec   (tonnes metered at the recovery plant; reported as a separate line, never netted, G-06)
// V-08: a removal without a metering source warns. J-05: whether it is a removal depends on the end use, a
// judgement a person confirms every time.
import { z } from 'zod'
import { isoDay, warn, blocked, type Issue, type Method, type Outcome, type RecordInput, type Reference } from '../core/types.js'
import { allowedUnitsOf, resolveUnit, toUnit } from '../core/units.js'

const CODE = 'C-08'
const parameters = z.object({
  meterReference: z.string().trim().min(1).max(200).optional(),
  endUse: z.string().trim().min(1).max(200).optional(),
}).strict()

function calculate(rec: RecordInput, ref: Reference): Outcome {
  const p = rec.parameters as z.infer<typeof parameters>
  const inputs: Record<string, unknown> = { quantity: rec.quantity, unitEntered: rec.unit, periodStart: isoDay(rec.periodStart), ...p }
  const resolved = resolveUnit(rec.unit, allowedUnitsOf(ref.activityTypes), ref.units)
  if ('issue' in resolved) return blocked(CODE, inputs, [resolved.issue])
  inputs.unit = resolved.unit.code
  const tonnes = toUnit(rec.quantity, resolved.unit, 't', ref.units)!.amount
  const issues: Issue[] = []
  if (!p.meterReference) issues.push(warn('V-08', 'Recovered CO2 needs a metering source. Attach the meter record or enter its reference.'))
  issues.push(warn('J-05', `Check the end use${p.endUse ? ` (${p.endUse})` : ''}: it counts as a removal only if the CO2 is stored permanently. CO2 that is released again when used (e.g. in drinks) does not count.`))
  return {
    formulaCode: CODE, status: 'CALCULATED', inputs, factor: null,
    selection: { rule: 'Metered recovered CO2, reported separately from gross emissions' },
    tCO2e: tonnes, gases: { CO2: tonnes.mul(1000).toString() }, issues, needsConfirmation: true,
  }
}

export const c08: Method = {
  formulaCode: CODE,
  title: 'Removals — recovered CO2 (reported separately)',
  scope: 1,
  line: 'REMOVALS',
  parameters,
  fields: [
    { name: 'meterReference', label: 'Meter or metering record reference', kind: 'text', hint: 'Removals must be metered.' },
    { name: 'endUse', label: 'End use of the CO2', kind: 'text', hint: 'e.g. permanent geological storage. CO2 released again when used (such as in drinks) is not a removal.' },
  ],
  calculate,
}
