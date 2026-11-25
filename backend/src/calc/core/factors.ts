// Workbook tab 05: which factor wins. Shared by every method that looks factors up.
import { block, isoDay, warn, type FactorRow, type Issue, type RegionRow } from './types.js'

import { dec, type Dec } from './decimal.js'

// One GWP set per run and report (V-12); AR6 is the workbook default (S-21), AR5 is chosen per run (J-09).

const validOn = (f: FactorRow, on: Date) => f.validFrom.getTime() <= on.getTime() && (!f.validTo || f.validTo.getTime() >= on.getTime())

// Rules 4 and 14: the factor in force on the reporting period's start date (frozen for the year);
// if several are, the most recently published, with the others recorded.
export function selectFactor(factors: FactorRow[], activityCodes: string[], regionCode: string | null, periodStart: Date) {
  const pool = factors.filter((f) => f.activityCode != null && activityCodes.includes(f.activityCode) && f.regionCode === regionCode)
  const candidates = pool
    .filter((f) => validOn(f, periodStart))
    // The organisation's own approved factor (site or supplier specific) is preferred over the platform default.
    .sort((a, b) => Number(!!b.organizationId) - Number(!!a.organizationId) || b.validFrom.getTime() - a.validFrom.getTime() || b.createdAt.getTime() - a.createdAt.getTime())
  const newer = pool.filter((f) => f.validFrom.getTime() > periodStart.getTime())
  return { factor: candidates[0] ?? null, others: candidates.slice(1), newer, anyForRegion: pool.length > 0 }
}

export type GridFactorPick =
  | { ok: true; factor: FactorRow; region: RegionRow; used: RegionRow; others: FactorRow[]; newer: FactorRow[]; issues: Issue[] }
  | { ok: false; issue: Issue; region?: RegionRow }

// Grid electricity: rule 9 (the region's own factor, else its fallback region's, flagged for review),
// with rules 4 and 14 inside each region, and checks V-03, V-04 and V-18.
export function selectGridFactor(gridLocation: string | null, regions: RegionRow[], factors: FactorRow[], activityCodes: string[], periodStart: Date): GridFactorPick {
  if (!gridLocation) return { ok: false, issue: block('V-18', 'This facility has no grid region. Set its grid location in Boundary Setup.') }
  const region = regions.find((r) => r.name === gridLocation)
  if (!region) return { ok: false, issue: block('V-18', `Grid region "${gridLocation}" is not recognised. Choose a listed grid region in Boundary Setup.`) }

  const issues: Issue[] = []
  let used = region
  let pick = selectFactor(factors, activityCodes, region.code, periodStart)
  let anyFactor = pick.anyForRegion
  if (!pick.factor && region.fallbackCode) {
    const fallback = regions.find((r) => r.code === region.fallbackCode)
    const fb = fallback && selectFactor(factors, activityCodes, fallback.code, periodStart)
    anyFactor ||= !!fb?.anyForRegion
    if (fallback && fb?.factor) {
      used = fallback
      pick = fb
      issues.push(warn('R-09', `There is no published factor for ${region.name}, so the ${fallback.name} factor was used. Check the facility's grid region is correct.`))
    }
  }
  if (!pick.factor) {
    return {
      ok: false, region,
      issue: anyFactor
        ? block('V-03', `No emission factor is valid for ${region.name} on ${isoDay(periodStart)} (the reporting period start). Add the factor version for this year to the factor library.`)
        : block('V-18', `No emission factor is loaded for ${region.name}. Add one to the factor library or choose another grid region.`),
    }
  }
  const factor = pick.factor
  if (pick.newer.length) {
    issues.push(warn('V-04', `A newer factor version exists (${pick.newer.map((f) => `${f.code} ${f.sourceVersion}`).join(', ')}). The version in force at the start of this reporting period (${factor.code} ${factor.sourceVersion}) was used. Confirm this is intended.`))
  }
  if (pick.others.length) {
    issues.push(warn('R-14', `More than one published factor applies to this period; the latest (${factor.code}) was used. No action needed.`))
  }
  return { ok: true, factor, region, used, others: pick.others, newer: pick.newer, issues }
}

// Rules 4 and 14 for one gas of one activity (no region), with V-03 / V-04 / R-14 as issues.
export function selectGasFactor(factors: FactorRow[], activityCode: string, gas: string, periodStart: Date) {
  const pick = selectFactor(factors.filter((f) => f.gas === gas), [activityCode], null, periodStart)
  const issues: Issue[] = []
  if (!pick.factor) {
    return { factor: null, issues: [block('V-03', `No ${gas} emission factor is valid for ${activityCode} on ${isoDay(periodStart)} (the reporting period start). Add one to the factor library.`)] }
  }
  if (pick.newer.length) issues.push(warn('V-04', `A newer ${gas} factor exists (${pick.newer.map((f) => f.code).join(', ')}); ${pick.factor.code}, in force at the period start, was used. Confirm this is intended.`))
  if (pick.others.length) issues.push(warn('R-14', `More than one published ${gas} factor applies; the latest (${pick.factor.code}) was used. No action needed.`))
  return { factor: pick.factor, issues }
}

// Rule 8 / C-09: a GWP is a property of the gas in the report's GWP set, not of the period, so it is
// picked by set (and, for methane, by fossil or non-fossil origin) rather than by validity date. The set is the
// structured gwpSet column, never the text of the source version.
export function selectGwp(factors: FactorRow[], match: { activityCode: string | null; gas: string; origin?: string }, set: 'AR6' | 'AR5'): FactorRow | null {
  return factors
    .filter((f) => f.activityCode === match.activityCode && f.gas === match.gas && f.gwpSet === set && (!match.origin || f.carbonOrigin === match.origin))
    .sort((a, b) => b.validFrom.getTime() - a.validFrom.getTime())[0] ?? null
}

// C-09: tCO2e = sum(E_gas x GWP_gas) / 1000, gas masses in kg. CO2 counts at GWP 1 unless biogenic (memo).
export function toCO2eTonnes(kg: { CO2?: Dec; CH4?: Dec; N2O?: Dec }, gwp: { CH4?: { toString(): string }; N2O?: { toString(): string } }, countCO2 = true): Dec {
  let total = countCO2 && kg.CO2 ? kg.CO2 : dec(0)
  if (kg.CH4) total = total.add(kg.CH4.mul(dec(gwp.CH4!.toString())))
  if (kg.N2O) total = total.add(kg.N2O.mul(dec(gwp.N2O!.toString())))
  return total.div(1000)
}
