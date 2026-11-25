// Workbook tab 03 conversions and checks V-01 / V-16.
import { dec, type Dec } from './decimal.js'
import { block, type ActivityTypeRow, type Decimalish, type Issue, type UnitRow } from './types.js'

export const allowedUnitsOf = (types: ActivityTypeRow[]) =>
  [...new Set(types.flatMap((t) => (Array.isArray(t.allowedUnits) ? (t.allowedUnits as string[]) : [])))]

// The unit must exist in tab 03 and be allowed for the activity. Case is forgiven ("kwh"); the record
// keeps what was entered (R-01) and the result notes the canonical code.
export function resolveUnit(entered: string, allowed: string[], units: UnitRow[]): { unit: UnitRow } | { issue: Issue } {
  const unit = units.find((u) => u.code.toLowerCase() === entered.trim().toLowerCase())
  if (!entered.trim() || !unit) return { issue: block('V-01', `Unit "${entered}" is not recognised. Choose one of: ${allowed.join(', ')}.`) }
  if (!allowed.includes(unit.code)) return { issue: block('V-16', `Unit "${unit.code}" is not valid for this activity. Use one of: ${allowed.join(', ')}.`) }
  return { unit }
}

// C-16: x_base = x × k_unit, then down to the target unit. No rounding (R-02). Null across dimensions.
export function convert(quantity: Decimalish, from: UnitRow, to: UnitRow): Dec | null {
  if (from.dimension !== to.dimension) return null
  return dec(quantity.toString()).mul(dec(from.toBase.toString())).div(dec(to.toBase.toString()))
}

export const conversionFactor = (from: UnitRow, to: UnitRow) => dec(from.toBase.toString()).div(dec(to.toBase.toString()))

// Factor numerators the engine understands, as a multiplier to tonnes.
export const TO_TONNES: Record<string, string> = { tCO2e: '1', kgCO2e: '0.001' } // workbook also writes "kg CO2e": strip spaces first

// Converts to the unit a factor is expressed per; null when the dimensions differ.
export function toUnit(quantity: Decimalish, from: UnitRow, toCode: string, units: UnitRow[]) {
  const to = units.find((u) => u.code === toCode)
  const amount = to && convert(quantity, from, to)
  return to && amount ? { to, amount, factor: conversionFactor(from, to) } : null
}
