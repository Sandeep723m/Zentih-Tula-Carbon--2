// Workbook TC-DOM-002a tab 06, fuel combustion (Scope 1):
//   C-01 stationary, fossil      E_gas = M_fuel × NCV × EF_gas / 1000   (gas = CO2, CH4, N2O), CO2e via C-09
//   C-02 stationary, biomass     same arithmetic; CO2 is a biogenic memo item, CH4 and N2O count in Scope 1
//   C-03 mobile                  as C-01 with the mobile CH4/N2O factors; distance ÷ fuel economy first (C-15)
// The fuel reaches tonnes by C-16 (mass units), C-13 (volume × density, V-09) or C-15 then C-13 (distance);
// energy-unit entries skip the mass step and are put on an NCV basis by C-14 (GCV × 0.95 or 0.90).
// TJ = t × NCV (C-23, NCV in TJ/t). Nothing is rounded (R-02, R-03).
import { z } from 'zod'
import { dec, ZERO, type Dec } from '../core/decimal.js'
import { selectGasFactor, selectGwp } from '../core/factors.js'
import { block, blocked, isoDay, warn, type ActivityTypeRow, type FactorRow, type FuelPropertyRow, type Issue, type Method, type Outcome, type RecordInput, type Reference } from '../core/types.js'
import { allowedUnitsOf, resolveUnit, toUnit } from '../core/units.js'

const positive = (what: string) => z.union([z.number(), z.string()]).transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,9}(\.\d{1,12})?$/, `${what} must be a number`))
  .refine((v) => Number(v) > 0, `${what} must be greater than zero`)
const percent = (what: string) => z.union([z.number(), z.string()]).transform((v) => String(v).trim())
  .pipe(z.string().regex(/^\d{1,3}(\.\d{1,6})?$/, `${what} must be a percentage`))
  .refine((v) => Number(v) <= 100, `${what} cannot be above 100%`)

const parameters = z.object({
  density: positive('Density').optional(),
  densityUnit: z.enum(['kg/l', 'kg/m3']).optional(),
  ncv: positive('Net calorific value').optional(),
  energyBasis: z.enum(['NCV', 'GCV']).optional(),
  fuelEconomy: positive('Fuel economy').optional(),
  // Tab 05 rule 5: the consignment's own CO2 factor (kg CO2 per TJ), with its source (V-11).
  co2Factor: positive('CO2 emission factor').optional(),
  co2FactorSource: z.string().trim().min(1).max(200).optional(),
  // V-02 / V-17, J-12 / J-16: the record's carbon origin, and for blends the biogenic share of the carbon.
  carbonOrigin: z.enum(['Fossil', 'Biogenic', 'Mixed']).optional(),
  biogenicSharePct: percent('Biogenic share').optional(),
  fossilSharePct: percent('Fossil share').optional(),
  biogenicShareEvidence: z.string().trim().min(1).max(200).optional(),
}).strict()
type Params = z.infer<typeof parameters>

const fields: Method['fields'] = [
  { name: 'density', label: 'Density (volume entries)', kind: 'decimal', hint: 'From the supplier certificate, at the measurement temperature. Leave empty to use the approved monthly lab value or, with a confirmation, the standard density.' },
  { name: 'densityUnit', label: 'Density unit', kind: 'select', options: [{ value: 'kg/l', label: 'kg per litre' }, { value: 'kg/m3', label: 'kg per m³' }] },
  { name: 'ncv', label: 'Net calorific value, TJ per tonne (optional)', kind: 'decimal', hint: 'This consignment\'s lab value. Leave empty to use the approved monthly lab value (Fuel Properties) or the IPCC default.' },
  { name: 'energyBasis', label: 'Energy basis (energy-unit entries)', kind: 'select', options: [{ value: 'NCV', label: 'Net (NCV)' }, { value: 'GCV', label: 'Gross (GCV), converted to net' }], hint: 'Required when the quantity is in kWh, GJ, MMBtu…' },
  { name: 'co2Factor', label: 'Own CO₂ factor, kg CO₂ per TJ (optional)', kind: 'decimal', hint: 'Only with a fuel analysis for this consignment. Checked against the IPCC default.' },
  { name: 'co2FactorSource', label: 'Source of the own CO₂ factor', kind: 'text', hint: 'Analysis or certificate reference. Required with an own factor.' },
  { name: 'carbonOrigin', label: 'Carbon origin', kind: 'select', options: [{ value: 'Fossil', label: 'Fossil' }, { value: 'Biogenic', label: 'Biogenic' }, { value: 'Mixed', label: 'Mixed / blend' }], hint: 'Defaults to the fuel\'s origin. Choose Mixed for blends (e.g. B7 diesel) and enter the biogenic share.' },
  { name: 'biogenicSharePct', label: 'Biogenic share of the carbon, %', kind: 'decimal', hint: 'Mixed only. From the supplier certificate.' },
  { name: 'fossilSharePct', label: 'Fossil share, % (optional check)', kind: 'decimal', hint: 'If given, fossil + biogenic must equal 100%.' },
  { name: 'biogenicShareEvidence', label: 'Certificate for the biogenic share', kind: 'text', hint: 'Mixed only. Certificate or document reference.' },
]
const mobileFields: Method['fields'] = [...fields, { name: 'fuelEconomy', label: 'Fuel economy, km per litre (distance entries)', kind: 'decimal', hint: 'Only when the quantity is a distance (C-15).' }]

const LITRES_PER_M3 = dec(1000)
const GCV_TO_NCV = { liquidOrSolid: dec('0.95'), gas: dec('0.9') } // tab 03 GCV->NCV rows
const CO2_PER_C = dec(44).div(12) // IPCC 2006 vol.2 ch.1: CO2 = carbon × 44/12
const ym = (d: Date) => d.getUTCFullYear() * 12 + d.getUTCMonth()
const monthName = (d: Date) => d.toISOString().slice(0, 7)

// Tab 05 rules 1 and 5: the approved monthly lab values for this fuel at this facility. Applied only when the
// record falls inside one calendar month (a multi-month record cannot take one month's values), never silently:
// values awaiting approval are reported, not used.
function registerRow(rec: RecordInput, ref: Reference, activityCode: string): { row: FuelPropertyRow | null; issues: Issue[] } {
  if (!rec.facilityId || !rec.startDate || !ref.fuelProperties?.length) return { row: null, issues: [] }
  const start = ym(rec.startDate)
  const end = ym(rec.endDate ?? rec.startDate)
  const rows = ref.fuelProperties.filter((p) => p.facilityId === rec.facilityId && p.activityCode === activityCode && ym(p.month) >= start && ym(p.month) <= end)
  if (!rows.length) return { row: null, issues: [] }
  if (start !== end) return { row: null, issues: [warn('FP-02', 'This record covers more than one month, so the monthly laboratory values for this fuel were not applied. Enter one record per month to use them.')] }
  const row = rows.filter((p) => p.status === 'APPROVED').sort((a, b) => b.version - a.version)[0] ?? null
  const pending = rows.filter((p) => p.status === 'DRAFT' && (!row || p.version > row.version))
  const issues = pending.length
    ? [warn('FP-01', row
      ? `A newer laboratory value for ${monthName(rec.startDate)} is awaiting approval; the approved version ${row.version} (${row.certificateRef}) was used.`
      : `A laboratory value for ${monthName(rec.startDate)} is awaiting approval and was not used. Approve it in Fuel Properties, or confirm the values below.`)]
    : []
  return { row, issues }
}

// The value used, in order: this record (consignment), the approved monthly register, the workbook default.
type Origin = 'entered' | 'register' | 'default'

function calculator(code: 'C-01' | 'C-02' | 'C-03') {
  return (rec: RecordInput, ref: Reference): Outcome => {
    const p = rec.parameters as Params
    const inputs: Record<string, unknown> = { quantity: rec.quantity, unitEntered: rec.unit, periodStart: isoDay(rec.periodStart), ...p }
    const activity: ActivityTypeRow | undefined = ref.activityTypes.length === 1 ? ref.activityTypes[0] : undefined
    if (!activity) return blocked(code, inputs, [block('SRC-01', 'Select the fuel on this emission source (Emission Sources page) so the right factors apply.')])
    inputs.activityCode = activity.code

    // ---- V-02 / V-17: carbon origin, and the biogenic share for blends (J-12, J-16) ----
    const fuelOrigin = activity.carbonOrigin?.trim() || null
    const origin = p.carbonOrigin ?? fuelOrigin
    if (!origin) return blocked(code, inputs, [block('V-02', 'Carbon origin is not set. Select Fossil, Biogenic or Mixed for this activity.')])
    if (fuelOrigin && origin !== 'Mixed' && origin !== fuelOrigin) {
      return blocked(code, inputs, [block('V-17', `The carbon origin (${origin}) does not match the fuel, which is ${fuelOrigin}. For a blend, choose Mixed and enter the biogenic share.`)])
    }

    inputs.carbonOrigin = origin // snapshotted so the record alone shows the origin that was applied
    const resolved = resolveUnit(rec.unit, allowedUnitsOf([activity]), ref.units)
    if ('issue' in resolved) return blocked(code, inputs, [resolved.issue])
    const unit = resolved.unit
    inputs.unit = unit.code
    const reg = registerRow(rec, ref, activity.code)
    const issues: Issue[] = [...reg.issues]
    if (reg.row) inputs.fuelProperty = { id: reg.row.id, month: isoDay(reg.row.month), version: reg.row.version, certificateRef: reg.row.certificateRef }
    const defaultsUsed: string[] = []

    let biogenicShare: Dec
    if (origin === 'Mixed') {
      const fromRecord = p.biogenicSharePct != null
      const pct = fromRecord ? dec(p.biogenicSharePct!) : reg.row?.biogenicShare != null ? dec(reg.row.biogenicShare.toString()).mul(100) : null
      if (pct == null) return blocked(code, inputs, [...issues, block('J-16', 'Enter the biogenic share of this blend (%), from the supplier certificate, or record it in Fuel Properties for this month.')])
      if (pct.lte(0) || pct.gte(100)) return blocked(code, inputs, [...issues, block('J-16', `A biogenic share of ${pct}% is not a blend. Choose ${pct.lte(0) ? 'Fossil' : 'Biogenic'} as the carbon origin instead.`)])
      if (p.fossilSharePct != null && !dec(p.fossilSharePct).add(pct).eq(100)) {
        return blocked(code, inputs, [...issues, block('J-16', `Fossil (${p.fossilSharePct}%) and biogenic (${pct}%) shares must add up to 100%.`)])
      }
      if (fromRecord && !p.biogenicShareEvidence) return blocked(code, inputs, [...issues, block('J-12', 'Give the certificate or document that states the biogenic share of this blend.')])
      biogenicShare = pct.div(100)
      inputs.biogenicShare = biogenicShare.toString()
      inputs.biogenicShareSource = fromRecord ? 'entered' : 'register'
    } else {
      biogenicShare = origin === 'Biogenic' ? dec(1) : ZERO
    }
    inputs.carbonOrigin = origin

    // ---- NCV (TJ per tonne): entered, then the approved register, then the IPCC default ----
    const ncvPick: { value: Dec; origin: Origin } | null = p.ncv ? { value: dec(p.ncv), origin: 'entered' }
      : reg.row?.ncv != null ? { value: dec(reg.row.ncv.toString()), origin: 'register' }
        : activity.defaultNcv != null ? { value: dec(activity.defaultNcv.toString()), origin: 'default' } : null
    const checkNcv = (ncv: Dec) => {
      if (ncv.gt(100) || ncv.lt('0.001')) issues.push(warn('V-14', 'This calorific value looks like it is in the wrong unit. Enter it in TJ per tonne (for example, 43 GJ/t is 0.043 TJ/t).'))
      const def = activity.defaultNcv != null ? dec(activity.defaultNcv.toString()) : null
      if (def && ncv.sub(def).abs().div(def).gt('0.2')) issues.push(warn('V-10', `This calorific value is ${ncv.sub(def).div(def).mul(100).toDecimalPlaces(0)}% from the default (${def} TJ/t). Check units and attach the lab report.`))
    }

    // ---- energy content, TJ (NCV basis), and the fuel mass when it is known ----
    let tj: Dec
    let tonnes: Dec | null = null
    if (unit.dimension === 'Energy') {
      if (!p.energyBasis) return blocked(code, inputs, [...issues, block('C-14', 'State whether this energy quantity is on a net (NCV) or gross (GCV) basis.')])
      const gaseous = allowedUnitsOf([activity]).includes('SCM')
      const k = p.energyBasis === 'NCV' ? dec(1) : gaseous ? GCV_TO_NCV.gas : GCV_TO_NCV.liquidOrSolid
      tj = toUnit(rec.quantity, unit, 'TJ', ref.units)!.amount.mul(k)
      inputs.ncvBasisFactor = k.toString()
      if (p.energyBasis === 'GCV') issues.push(warn('V-06', `You entered energy on a gross calorific (GCV) basis, so it was converted to net (×${k}). If your bill already states net (NCV), change the energy basis to NCV.`))
      if (ncvPick) tonnes = tj.div(ncvPick.value) // only needed for a carbon-content CO2 factor
    } else {
      if (unit.dimension === 'Mass') {
        tonnes = toUnit(rec.quantity, unit, 't', ref.units)!.amount
      } else {
        let m3: Dec
        const liquid = unit.dimension !== 'Volume (gas)' // litres, kl, m3, gallons, barrels, and fuel from a distance
        if (unit.dimension === 'Distance') {
          if (!p.fuelEconomy) return blocked(code, inputs, [...issues, block('C-15', 'Enter the fuel economy (km per litre) to turn the distance into fuel.')])
          const litres = toUnit(rec.quantity, unit, 'km', ref.units)!.amount.div(dec(p.fuelEconomy))
          inputs.fuelLitres = litres.toString()
          m3 = litres.div(LITRES_PER_M3)
        } else {
          m3 = dec(rec.quantity).mul(dec(unit.toBase.toString())) // tab 03: every volume row, gas or liquid, has base m3
        }
        // V-09: density from the record, then the approved register, then the workbook default (indicative,
        // needs a confirmation). A default quoted for the liquid (kg/l) is never applied to a gas volume, or the reverse.
        const defaultFits = activity.defaultDensity != null && (activity.defaultDensityUnit === 'kg/l') === liquid
        const density: { value: Dec; unit: string; origin: Origin } | null = p.density && p.densityUnit ? { value: dec(p.density), unit: p.densityUnit, origin: 'entered' }
          : reg.row?.density != null && reg.row.densityUnit ? { value: dec(reg.row.density.toString()), unit: reg.row.densityUnit, origin: 'register' }
            : defaultFits ? { value: dec(activity.defaultDensity!.toString()), unit: activity.defaultDensityUnit!, origin: 'default' } : null
        if (!density) {
          const why = activity.defaultDensity != null && !defaultFits
            ? ` The standard density for this fuel (${activity.defaultDensity} ${activity.defaultDensityUnit}) is for the ${activity.defaultDensityUnit === 'kg/l' ? 'liquid' : 'gas'}, not a ${liquid ? 'liquid' : 'gas'} volume.`
            : ''
          return blocked(code, inputs, [...issues, block('V-09', `Density is needed to convert volume to mass. Enter the density and its unit from the supplier certificate.${why}`)])
        }
        if (density.origin === 'default') {
          defaultsUsed.push('default density')
          issues.push(warn('J-04', `No certificate density was given, so the standard indicative density for this fuel (${density.value} ${density.unit}) was used. Enter the supplier certificate density for this consignment if you have it.`))
        }
        inputs.densityUsed = density.value.toString()
        inputs.densityUnitUsed = density.unit
        inputs.densitySource = density.origin === 'default' ? activity.defaultDensitySource ?? 'standard default' : density.origin
        const kgPerM3 = density.unit === 'kg/l' ? density.value.mul(LITRES_PER_M3) : density.value // C-13
        tonnes = m3.mul(kgPerM3).div(1000)
      }
      inputs.massTonnes = tonnes.toString()
      if (!ncvPick) return blocked(code, inputs, [...issues, block('C-23', `No default net calorific value is known for ${activity.name}. Enter the lab NCV (TJ per tonne).`)])
      tj = tonnes.mul(ncvPick.value) // C-23
    }
    if (ncvPick) {
      inputs.ncvUsed = ncvPick.value.toString()
      inputs.ncvSource = ncvPick.origin === 'entered' ? 'entered' : ncvPick.origin === 'register' ? 'fuel properties register (approved)' : 'IPCC default'
      if (ncvPick.origin !== 'default') checkNcv(ncvPick.value)
      if (ncvPick.origin === 'entered') issues.push(warn('R-05', 'Your own calorific value is used instead of the standard one. Attach the fuel test or supplier certificate that shows it.'))
      if (ncvPick.origin === 'default' && (unit.dimension !== 'Energy' || reg.row?.carbonContent != null)) defaultsUsed.push('default NCV')
    }
    inputs.energyTJ = tj.toString()

    // ---- per-gas emissions, kg (R-03) ----
    const used: Record<string, FactorRow> = {}
    const kg: Record<string, Dec> = {}
    for (const gas of ['CO2', 'CH4', 'N2O']) {
      const pick = selectGasFactor(ref.factors, activity.code, gas, rec.periodStart)
      if (!pick.factor) return blocked(code, inputs, [...issues, ...pick.issues])
      if (!/^kg /.test(pick.factor.numeratorUnit) || !/^TJ/.test(pick.factor.denominatorUnit)) {
        return blocked(code, inputs, [...issues, block('V-03', `Factor ${pick.factor.code} is in ${pick.factor.numeratorUnit} per ${pick.factor.denominatorUnit}; combustion needs kg per TJ.`)])
      }
      issues.push(...pick.issues)
      used[gas] = pick.factor
      kg[gas] = tj.mul(dec(pick.factor.value.toString()))
    }

    // ---- CO2 from site data (tab 05 rules 5 and 1), checked against the IPCC default (V-11) ----
    let co2Tier = used.CO2.tier
    const defaultCO2 = dec(used.CO2.value.toString())
    const checkOwn = (perTJ: Dec, what: string) => {
      const diff = perTJ.sub(defaultCO2).div(defaultCO2)
      if (diff.abs().gt('0.1')) issues.push(warn('V-11', `${what} (${perTJ.toDecimalPlaces(1)} kg CO2/TJ) is ${diff.mul(100).toDecimalPlaces(0)}% from the default ${used.CO2.code} (${defaultCO2} kg/TJ). Attach the analysis or source.`))
    }
    if (p.co2Factor) {
      kg.CO2 = tj.mul(dec(p.co2Factor))
      inputs.co2FactorUsed = p.co2Factor
      inputs.co2FactorSource = p.co2FactorSource ?? null
      co2Tier = 'Tier 3 - consignment factor'
      checkOwn(dec(p.co2Factor), 'This factor')
      if (!p.co2FactorSource) return blocked(code, inputs, [...issues, block('V-11', 'An own CO2 factor was entered without a source. Give the analysis or certificate reference.')])
    } else if (reg.row?.carbonContent != null) {
      if (!tonnes) return blocked(code, inputs, [...issues, block('C-23', 'The laboratory carbon content needs the fuel mass; enter the NCV for this energy quantity.')])
      const ox = reg.row.oxidationFactor != null ? dec(reg.row.oxidationFactor.toString()) : dec(1)
      kg.CO2 = tonnes.mul(dec(reg.row.carbonContent.toString())).mul(CO2_PER_C).mul(ox).mul(1000)
      const perTJ = kg.CO2.div(tj)
      inputs.carbonContent = reg.row.carbonContent.toString()
      inputs.oxidationFactor = ox.toString()
      inputs.co2FactorUsed = perTJ.toString()
      inputs.co2FactorSource = `carbon content × 44/12 × oxidation, certificate ${reg.row.certificateRef}`
      co2Tier = 'Tier 3 - site laboratory analysis'
      checkOwn(perTJ, 'The CO2 factor from the laboratory carbon content')
    }

    const defaults = [...Object.entries(used).filter(([gas, f]) => /^Tier 1/i.test(f.tier) && !(gas === 'CO2' && co2Tier.startsWith('Tier 3'))).map(([, f]) => f.code), ...defaultsUsed]
    if (defaults.length) issues.push(warn('R-03', 'Standard international (IPCC) factors are used for this fuel. That is fine for most companies; if you have a fuel test certificate or a supplier-stated value, enter it for a more accurate result.'))

    // ---- C-09: CO2e with the report's GWP set. Biogenic CO2 is a memo item; methane from the biogenic share
    // takes the non-fossil GWP. A blend splits by its biogenic share of carbon. ----
    const fossilShare = dec(1).sub(biogenicShare)
    const gwpFossilCH4 = fossilShare.gt(0) ? selectGwp(ref.factors, { activityCode: null, gas: 'CH4', origin: 'Fossil' }, ref.gwpSet) : null
    const gwpBioCH4 = biogenicShare.gt(0) ? selectGwp(ref.factors, { activityCode: null, gas: 'CH4', origin: 'Biogenic' }, ref.gwpSet) : null
    const gwpN2O = selectGwp(ref.factors, { activityCode: null, gas: 'N2O' }, ref.gwpSet)
    const missing = (fossilShare.gt(0) && !gwpFossilCH4) ? 'CH4' : (biogenicShare.gt(0) && !gwpBioCH4) ? 'non-fossil CH4' : !gwpN2O ? 'N2O' : null
    if (missing) return blocked(code, inputs, [...issues, block('V-03', `No ${ref.gwpSet} GWP is loaded for ${missing}. AR5 values are available for fossil CH4 and N2O only.`)])
    const ch4Gwp = (gwpFossilCH4 ? fossilShare.mul(dec(gwpFossilCH4.value.toString())) : ZERO).add(gwpBioCH4 ? biogenicShare.mul(dec(gwpBioCH4.value.toString())) : ZERO)
    const fossilCO2 = kg.CO2.mul(fossilShare)
    const biogenicCO2 = kg.CO2.mul(biogenicShare)
    const tCO2e = fossilCO2.add(kg.CH4.mul(ch4Gwp)).add(kg.N2O.mul(dec(gwpN2O!.value.toString()))).div(1000)
    if (origin === 'Mixed') issues.push(warn('J-12', `Blend: ${biogenicShare.mul(100)}% of the CO2 is reported as biogenic (memo) and ${fossilShare.mul(100)}% in Scope 1. Confirm the share matches the supplier certificate.`))

    const gwp = (f: FactorRow | null) => f && { code: f.code, value: f.value.toString() }
    return {
      formulaCode: code,
      status: 'CALCULATED',
      inputs,
      factor: used.CO2,
      selection: {
        rule: co2Tier.startsWith('Tier 3') ? 'Site or consignment CO2 factor, IPCC CH4 and N2O'
          : code === 'C-03' ? 'Mode-specific CH4 and N2O, CO2 from fuel carbon' : biogenicShare.gt(0) ? 'Biogenic CO2 reported separately' : 'Factor in force at the period start',
        co2Tier,
        factors: Object.fromEntries(Object.entries(used).map(([gas, f]) => [gas, { code: f.code, value: f.value.toString(), unit: `${f.numeratorUnit}/${f.denominatorUnit}`, tier: f.tier }])),
        gwp: { set: ref.gwpSet, basis: 'GWP-100', CH4: gwp(gwpFossilCH4), CH4NonFossil: gwp(gwpBioCH4), N2O: gwp(gwpN2O) },
      },
      tCO2e,
      biogenicTCO2: biogenicShare.gt(0) ? biogenicCO2.div(1000) : null,
      gases: { CO2: kg.CO2.toString(), CH4: kg.CH4.toString(), N2O: kg.N2O.toString(), ...(origin === 'Mixed' ? { CO2_fossil: fossilCO2.toString(), CO2_biogenic: biogenicCO2.toString() } : {}) },
      issues,
      needsConfirmation: issues.some((i) => i.severity === 'WARN'),
    }
  }
}

const base = { scope: 1 as const, line: 'SCOPE1' as const, parameters }
export const c01: Method = { ...base, formulaCode: 'C-01', title: 'Scope 1 — stationary combustion, fossil fuel', fields, calculate: calculator('C-01') }
export const c02: Method = { ...base, formulaCode: 'C-02', title: 'Scope 1 — stationary combustion, biomass (biogenic CO2 as memo)', fields, calculate: calculator('C-02') }
export const c03: Method = { ...base, formulaCode: 'C-03', title: 'Scope 1 — mobile combustion', fields: mobileFields, calculate: calculator('C-03') }
