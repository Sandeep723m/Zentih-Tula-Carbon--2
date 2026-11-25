// Shapes shared by every calculation method. The engine never touches the database:
// the run service loads a Reference once and passes plain rows in.
import type { z } from 'zod'
import type { Dec } from './decimal.js'

// Workbook tab 10 severities. BLOCK stops the calculation; WARN calculates but needs a person to confirm with a reason.
export type Severity = 'BLOCK' | 'WARN'
export interface Issue { code: string; severity: Severity; message: string }

export type Decimalish = Dec | { toString(): string } | string
export interface UnitRow { code: string; dimension: string; toBase: Decimalish }
export interface RegionRow { code: string; name: string; fallbackCode: string | null }
export interface ActivityTypeRow {
  code: string; name: string; category: string; formulaCode: string | null; allowedUnits: unknown
  measuredIn: string; carbonOrigin: string; defaultNcv: Decimalish | null // TJ per tonne
  defaultNcvSource?: string | null
  defaultDensity?: Decimalish | null; defaultDensityUnit?: string | null; defaultDensitySource?: string | null
}
export interface FactorRow {
  id: string; code: string; activityCode: string | null; gas: string; value: Decimalish; numeratorUnit: string; denominatorUnit: string
  carbonOrigin: string; source: string; sourceVersion: string; tier: string
  validFrom: Date; validTo: Date | null; regionCode: string | null; createdAt: Date
  gwpSet?: string | null; status?: string; organizationId?: string | null
}

// An approved row of the site fuel properties register (Tier 3): one fuel, one facility, one calendar month.
export interface FuelPropertyRow {
  id: string; facilityId: string; activityCode: string; month: Date; version: number; status: string
  ncv: Decimalish | null; density: Decimalish | null; densityUnit: string | null
  carbonContent: Decimalish | null; oxidationFactor: Decimalish | null; biogenicShare: Decimalish | null
  certificateRef: string
}

// Everything a method may use, loaded once per run. `activityTypes` are those measuring the record's
// source: its own activity (fuel, gas), or for legacy electricity sources every grid electricity type.
export type GwpSet = 'AR6' | 'AR5'
export interface Reference {
  units: UnitRow[]; regions: RegionRow[]; factors: FactorRow[]; activityTypes: ActivityTypeRow[]; gwpSet: GwpSet
  fuelProperties?: FuelPropertyRow[] // this organisation's register (any status; the engine applies APPROVED only)
}

// One activity record as the engine sees it. `parameters` are the method's own extra inputs.
export interface RecordInput {
  quantity: string
  unit: string
  gridLocation: string | null
  periodStart: Date
  parameters: Record<string, unknown>
  // The record's own dates and facility, for the monthly fuel properties register. Optional: worked examples omit them.
  facilityId?: string
  startDate?: Date
  endDate?: Date
}

export interface Outcome {
  formulaCode: string
  status: 'CALCULATED' | 'BLOCKED'
  inputs: Record<string, unknown> // what was used, stored with the result so it can be reproduced
  factor: FactorRow | null
  selection: Record<string, unknown> | null // which factor rule applied, and the alternatives
  tCO2e: Dec | null // unrounded (tab 08); for biomass, the CH4 and N2O only (C-02)
  biogenicTCO2?: Dec | null // C-02 memo item, never in the Scope 1 total (G-05)
  gases?: Record<string, string> | null // per-gas mass in kg, unrounded (R-03, G-11)
  issues: Issue[]
  needsConfirmation: boolean
}

// Tab 09 roll-up lines that are never added together (G-03, G-04, G-07).
// SCOPE2_HEAT: purchased steam, heat and cooling (C-21), its own line because tab 09 sums only C-06 and
// C-07 into the two electricity lines. REMOVALS (C-08) are shown beside, never netted (G-06).
export type ReportingLine = 'SCOPE1' | 'SCOPE2_LOCATION' | 'SCOPE2_MARKET' | 'SCOPE2_HEAT' | 'REMOVALS'
export const LINES: ReportingLine[] = ['SCOPE1', 'SCOPE2_LOCATION', 'SCOPE2_MARKET', 'SCOPE2_HEAT', 'REMOVALS']

// How the entry form asks for a method's extra inputs (served with the activity types).
export interface ParamField {
  name: string
  label: string
  kind: 'decimal' | 'select' | 'text'
  options?: { value: string; label: string }[]
  hint?: string
}

// A workbook tab 06 calculation. Adding one = a new file in methods/ registered in registry.ts.
export interface Method {
  formulaCode: string // tab 06 Calc ID, e.g. "C-06"
  title: string
  scope: 1 | 2
  line: ReportingLine // tab 09 roll-up line its results add to
  // Inputs beyond quantity and unit (density, NCV, instrument MWh…), checked when the record is saved.
  // Strict, so a stray field is refused instead of silently ignored.
  parameters: z.ZodObject
  fields: ParamField[]
  calculate(rec: RecordInput, ref: Reference): Outcome
}

export const block = (code: string, message: string): Issue => ({ code, severity: 'BLOCK', message })
export const warn = (code: string, message: string): Issue => ({ code, severity: 'WARN', message })
export const isoDay = (d: Date) => d.toISOString().slice(0, 10)

// A blocked outcome keeps whatever inputs were resolved before the block, for the drill-down.
export const blocked = (formulaCode: string, inputs: Record<string, unknown>, issues: Issue[]): Outcome =>
  ({ formulaCode, status: 'BLOCKED', inputs, factor: null, selection: null, tCO2e: null, issues, needsConfirmation: false })
