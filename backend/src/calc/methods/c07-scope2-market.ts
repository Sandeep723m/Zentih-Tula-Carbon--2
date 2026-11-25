// Workbook TC-DOM-002a tab 06, C-07 (with C-20): Scope 2 purchased electricity, market-based.
//   E_mkt = (MWh − Inst) × EF_residual + Inst × EF_inst
// Inst = MWh covered by contractual instruments (I-REC, PPA, green tariff); more than the MWh consumed is
// blocked (V-13). EF_inst: tab 04 A-PPA (EF-0340, zero). EF_residual: no Indian residual mix is published
// (EF-0341 blank), so the grid average is used with disclosure (tab 05 rule 10).
import { z } from 'zod'
import { dec, ZERO } from '../core/decimal.js'
import { selectFactor } from '../core/factors.js'
import { block, blocked, isoDay, warn, type Issue, type Method, type Outcome, type RecordInput, type Reference } from '../core/types.js'
import { TO_TONNES } from '../core/units.js'
import { gridBasis } from './c06-scope2-location.js'

const CODE = 'C-07'
const INSTRUMENT_ACTIVITY = 'A-PPA'
const INSTRUMENT_TYPES = [
  { value: 'I-REC', label: 'I-REC certificate' },
  { value: 'PPA', label: 'Power purchase agreement' },
  { value: 'GREEN_TARIFF', label: 'Green tariff' },
]

const mwh = z.union([z.number(), z.string()]).transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Instrument MWh must be a number with at most 6 decimal places'))

function calculate(rec: RecordInput, ref: Reference): Outcome {
  const g = gridBasis(CODE, rec, ref)
  if (g.outcome) return g.outcome
  const p = rec.parameters as { instrumentMWh?: string; instrumentType?: string; instrumentReference?: string }
  const inputs = { ...g.inputs, instrumentMWh: p.instrumentMWh ?? '0', instrumentType: p.instrumentType ?? null, instrumentReference: p.instrumentReference ?? null }

  // The consumption is in the grid factor's unit (MWh); instrument MWh are compared with it (V-13).
  const consumed = g.amount
  const inst = dec(p.instrumentMWh ?? '0')
  if (g.factor.denominatorUnit !== 'MWh') return blocked(CODE, inputs, [block('V-01', `Market-based needs a per-MWh grid factor; ${g.factor.code} is per ${g.factor.denominatorUnit}.`)])
  if (inst.gt(consumed)) return blocked(CODE, inputs, [block('V-13', `Instrument volume (${inst} MWh) cannot exceed consumption (${consumed} MWh). Correct the instrument quantity.`)])

  const issues: Issue[] = [...g.pick.issues]
  let instrument = null
  if (inst.gt(ZERO)) {
    if (!p.instrumentType || !p.instrumentReference) return blocked(CODE, inputs, [block('C-07', 'Enter the instrument type and its certificate or contract reference for the instrument-covered MWh.')])
    const pick = selectFactor(ref.factors.filter((f) => f.gas === 'CO2e'), [INSTRUMENT_ACTIVITY], null, rec.periodStart)
    if (!pick.factor || !TO_TONNES[pick.factor.numeratorUnit]) {
      return blocked(CODE, inputs, [block('V-03', `No contractual-instrument factor is valid on ${isoDay(rec.periodStart)} (the reporting period start). Add the ${INSTRUMENT_ACTIVITY} factor for this year to the factor library.`)])
    }
    instrument = pick.factor
    issues.push(warn('R-10', `Check the ${p.instrumentType} certificate (${p.instrumentReference}): it must cover this period, be from the Indian market, be retired in your name, and not be claimed by another site.`))
  }
  const remainder = consumed.sub(inst)
  issues.push(warn('Q-02', `The ${remainder} MWh not covered by certificates are counted at the Indian grid average. This is normal for India; no action needed.`))

  const residualT = remainder.mul(dec(g.factor.value.toString())).mul(g.toTonnes)
  const instrumentT = instrument ? inst.mul(dec(instrument.value.toString())).mul(dec(TO_TONNES[instrument.numeratorUnit])) : ZERO
  return {
    formulaCode: CODE,
    status: 'CALCULATED',
    inputs: { ...inputs, remainderMWh: remainder.toString() },
    factor: g.factor,
    selection: {
      ...g.selection,
      rule: 'Instrument factor on covered MWh; remainder at the grid average (no residual mix published)',
      residualFactorCode: g.factor.code, instrumentFactorCode: instrument?.code ?? null, instrumentFactorValue: instrument?.value.toString() ?? null,
    },
    tCO2e: residualT.add(instrumentT),
    issues,
    needsConfirmation: true, // the grid-average fallback is always a disclosed judgement (rule 10)
  }
}

export const c07: Method = {
  formulaCode: CODE,
  title: 'Scope 2 — purchased electricity, market-based',
  scope: 2,
  line: 'SCOPE2_MARKET',
  parameters: z.object({
    instrumentMWh: mwh.optional(),
    instrumentType: z.enum(INSTRUMENT_TYPES.map((t) => t.value) as [string, ...string[]]).optional(),
    instrumentReference: z.string().trim().min(1).max(200).optional(),
  }).strict(),
  fields: [
    { name: 'instrumentMWh', label: 'Instrument-covered MWh (market-based)', kind: 'decimal', hint: 'MWh covered by I-RECs, a PPA or a green tariff. Leave empty if none.' },
    { name: 'instrumentType', label: 'Instrument type', kind: 'select', options: INSTRUMENT_TYPES },
    { name: 'instrumentReference', label: 'Certificate or contract reference', kind: 'text' },
  ],
  calculate,
}
