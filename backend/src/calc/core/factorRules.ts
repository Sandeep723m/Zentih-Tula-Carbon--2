// Which factors a calculation may use: the gas, unit and "per" unit each formula understands, taken from the
// workbook's own tab 04 rows (WORKBOOK_FACTORS, including rows the SME left blank, such as EF-0342..0344),
// never from a hand-written list. A factor outside these shapes is refused when it is created and skipped when a
// calculation selects factors, so a mis-entered row (coal "per ton-hour") can never reach a result.
import { WORKBOOK_ACTIVITY_TYPES, WORKBOOK_FACTORS } from '../workbookData.js'
import type { ActivityTypeRow, FactorRow, UnitRow } from './types.js'

export interface Shape { gas: string; numeratorUnit: string; denominatorUnit: string }
const norm = (s: string) => s.replace(/\s+/g, '').toLowerCase()
const key = (s: Shape) => `${norm(s.gas)}|${norm(s.numeratorUnit)}|${norm(s.denominatorUnit)}`

// Formulas whose factors are interchangeable across activities (any fuel takes kg CO2 per TJ). Process
// factors (C-04) differ per activity, so they are matched per activity.
const FAMILY: Record<string, string> = { 'C-01': 'combustion', 'C-02': 'combustion', 'C-03': 'combustion', 'C-05': 'fugitive', 'C-06': 'grid', 'C-21': 'heat' }
const familyOf = (formula: string | null, code: string) => (formula && FAMILY[formula]) ?? (formula === 'C-04' ? `process:${code}` : null)

const WB_CATEGORY = new Map<string, string>(WORKBOOK_ACTIVITY_TYPES.map((a) => [a.code, a.category]))
const WB_FAMILY: Record<string, string> = {
  'Stationary combustion': 'combustion', 'Mobile combustion': 'combustion', Fugitive: 'fugitive',
  'Purchased electricity': 'grid', 'Purchased steam / heat / cooling': 'heat',
}
const WORKBOOK_SHAPES = new Map<string, Map<string, Shape>>()
for (const f of WORKBOOK_FACTORS) {
  if (!f.activityCode || !f.numeratorUnit || !f.denominatorUnit) continue
  const category = WB_CATEGORY.get(f.activityCode)
  const family = category === 'Process' ? `process:${f.activityCode}` : category && WB_FAMILY[category]
  if (!family) continue
  const shape = { gas: f.gas ?? 'CO2e', numeratorUnit: f.numeratorUnit, denominatorUnit: f.denominatorUnit }
  const shapes = WORKBOOK_SHAPES.get(family) ?? new Map<string, Shape>()
  shapes.set(key(shape), shape)
  WORKBOOK_SHAPES.set(family, shapes)
}

// Grid and heat factors are converted by the engine through tab 03 (kWh to MWh, kg to t), so any unit of the
// same dimension as a workbook one is equivalent. Combustion, fugitive and process factors are used as published.
const CONVERTIBLE = new Set(['grid', 'heat'])
const MASS_SCALE: Record<string, string> = { tco2e: 'tCO2e', kgco2e: 'kgCO2e' }

// Families with no library factor at all, and why (shown to the person adding one).
const NO_LIBRARY: Record<string, string> = {
  'C-08': 'Removals use the metered tonnes of CO2 recovered (C-08); they take no emission factor.',
}

export interface ShapeCheck { ok: true; shape: Shape } // the canonical workbook spelling to store
export type ShapeResult = ShapeCheck | { ok: false; message: string }

// The shapes a factor for this activity may take (served to the factor form so it offers only these).
export function allowedShapes(activity: Pick<ActivityTypeRow, 'code' | 'formulaCode'>): Shape[] {
  const family = familyOf(activity.formulaCode, activity.code)
  return family ? [...(WORKBOOK_SHAPES.get(family)?.values() ?? [])] : []
}

export function checkFactorShape(f: Shape, activity: Pick<ActivityTypeRow, 'code' | 'name' | 'formulaCode'>, units: UnitRow[]): ShapeResult {
  if (activity.formulaCode && NO_LIBRARY[activity.formulaCode]) return { ok: false, message: NO_LIBRARY[activity.formulaCode] }
  const family = familyOf(activity.formulaCode, activity.code)
  const shapes = family ? WORKBOOK_SHAPES.get(family) : undefined
  if (!family || !shapes?.size) return { ok: false, message: `${activity.name} has no calculation that uses a library factor, so a factor for it would never be applied.` }
  const exact = shapes.get(key(f))
  if (exact) return { ok: true, shape: exact }
  if (CONVERTIBLE.has(family)) {
    const unit = units.find((u) => norm(u.code) === norm(f.denominatorUnit))
    const numerator = MASS_SCALE[norm(f.numeratorUnit)]
    const match = [...shapes.values()].find((s) => {
      const base = units.find((u) => norm(u.code) === norm(s.denominatorUnit))
      return norm(s.gas) === norm(f.gas) && numerator && MASS_SCALE[norm(s.numeratorUnit)] && unit && base && unit.dimension === base.dimension
    })
    if (match && unit && numerator) return { ok: true, shape: { gas: match.gas, numeratorUnit: numerator, denominatorUnit: unit.code } }
  }
  const list = [...shapes.values()].map((s) => `${s.gas} in ${s.numeratorUnit} per ${s.denominatorUnit}`).join('; ')
  return { ok: false, message: `A ${f.gas} factor in ${f.numeratorUnit} per ${f.denominatorUnit} does not fit ${activity.name}. Accepted for this activity: ${list}.` }
}

// TC-ARC-006 2.1: names the tier and the owner wherever a factor appears (list, results, audit, reports).
export const factorLabel = (f: { organizationId?: string | null; tier: string }) => `${f.organizationId ? 'Tenant-defined' : 'Platform library'} · ${f.tier}`

// Selection guard: a factor row the engine may use for its activity. GWP rows (no activity) are checked by set.
export function usableFactor(f: FactorRow, activities: Map<string, ActivityTypeRow>, units: UnitRow[]) {
  if (f.status && f.status !== 'APPROVED' && f.status !== 'IN_USE') return false
  if (!f.activityCode) return f.gwpSet === 'AR6' || f.gwpSet === 'AR5'
  const activity = activities.get(f.activityCode)
  if (!activity) return false
  // A-PPA (contract instruments) has no formula of its own; C-07 reads it as tCO2e per MWh.
  if (!activity.formulaCode) return activity.code === 'A-PPA'
  return checkFactorShape(f, { ...activity, name: activity.name }, units).ok
}
