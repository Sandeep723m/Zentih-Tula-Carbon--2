export type Role = 'TENANT_ADMIN' | 'DATA_ENTRY' | 'REVIEWER' | 'VERIFIER'

export const ROLE_LABELS: Record<Role, string> = {
  TENANT_ADMIN: 'Tenant Admin',
  DATA_ENTRY: 'Data Entry',
  REVIEWER: 'Reviewer / Approver',
  VERIFIER: 'Verifier / VVB',
}

export interface Me {
  user: { id: string; email: string; name: string; mfaEnabled: boolean; platformRole: 'SUPER_ADMIN' | null; mustChangePassword: boolean }
  mfaVerified: boolean
  organization: { id: string; name: string } | null
  role: Role | null
  permissions: string[]
  access: OrgAccess | null
  accessReason: string | null
}

export type OrgAccess = 'full' | 'read' | 'none'

export interface OrganizationOption {
  id: string
  name: string
  role: Role
  access: OrgAccess
  reason: string | null
}

export const ROLES = Object.keys(ROLE_LABELS) as Role[]

export interface Organization {
  id: string
  name: string
  legalName: string | null
  country: string | null
  industry: string | null
  address: string | null
  timezone: string
  fiscalYearStartMonth: number
  requireEvidenceOnSubmit: boolean
  qualityAnomalyPercent: number
  qualityMinHistory: number
}

export interface Facility {
  id: string
  name: string
  code: string
  country: string | null
  city: string | null
  address: string | null
  isActive: boolean
}

export interface ReportingPeriod {
  id: string
  name: string
  startDate: string
  endDate: string
  status: 'OPEN' | 'LOCKED'
}

export type SourceCategory = 'FUEL_COMBUSTION' | 'FUGITIVE_GAS' | 'PURCHASED_ELECTRICITY' | 'PURCHASED_ENERGY' | 'PROCESS' | 'REMOVAL'

export const CATEGORY_LABELS: Record<SourceCategory, string> = {
  FUEL_COMBUSTION: 'Fuel combustion',
  FUGITIVE_GAS: 'Fugitive gas (refrigerants)',
  PURCHASED_ELECTRICITY: 'Purchased electricity',
  PURCHASED_ENERGY: 'Purchased heat / steam / cooling',
  PROCESS: 'Industrial process / on-site waste treatment',
  REMOVAL: 'Recovered CO2 (removal)',
}

export interface EmissionSource {
  id: string
  facilityId: string
  facility: { id: string; name: string; code: string }
  name: string
  category: SourceCategory
  scope: 1 | 2
  material: string | null
  activityCode: string | null
  activityType?: { code: string; name: string; formulaCode: string | null } | null
  defaultUnit: string | null
  isActive: boolean
}

export interface Member {
  id: string
  role: Role
  user: { id: string; email: string; name: string; isActive: boolean; mfaEnabled: boolean; mustChangePassword: boolean }
}

export type ActivityStatus = 'DRAFT' | 'SUBMITTED' | 'RETURNED' | 'APPROVED'

export interface Review { id: string; action: 'SUBMITTED' | 'APPROVED' | 'RETURNED'; fromStatus: ActivityStatus; toStatus: ActivityStatus; comment: string | null; createdAt: string; actor: { name: string } }
export interface Preview { formulaCode: string; title: string; status: 'CALCULATED' | 'BLOCKED'; tCO2e: string | null; biogenicTCO2: string | null; issues: CalcIssue[]; factorCode: string | null }

export interface Evidence {
  id: string
  fileName: string
  mimeType: string
  sizeBytes: number
  createdAt: string
  uploadedBy: { name: string }
}

export interface ActivityRecord {
  id: string
  facilityId: string
  reportingPeriodId: string
  emissionSourceId: string
  startDate: string
  endDate: string
  quantity: string
  unit: string
  parameters: Record<string, string> | null
  notes: string | null
  status: ActivityStatus
  submittedAt: string | null
  reviewedAt?: string | null
  returnReason?: string | null
  reviewedBy?: { id: string; name: string } | null
  reviews?: Review[]
  preview?: Preview[] | null // reviewers: what the calculation would give now
  createdAt: string
  updatedAt: string
  facility: { id: string; name: string; code: string }
  reportingPeriod: { id: string; name: string; startDate: string; endDate: string; status: 'OPEN' | 'LOCKED' }
  emissionSource: { id: string; name: string; category: SourceCategory; material: string | null; activityCode?: string | null; defaultUnit: string | null }
  createdBy: { id: string; name: string }
  updatedBy?: { id: string; name: string }
  evidence?: Evidence[]
  _count?: { evidence: number }
  calculation?: CalcResult | null // latest calculation; only for roles that may read results
  calculations?: CalcResult[] // every method's result in the latest run (location and market for electricity)
}

export interface ActivitySummary {
  total: number
  draft: number
  submitted: number
  returned: number
  approved: number
  byFacilityPeriod: Array<{
    facility: { id: string; name: string; code: string }
    period: { id: string; name: string; status: 'OPEN' | 'LOCKED' }
    draft: number
    submitted: number
    returned: number
    approved: number
  }>
  recent: ActivityRecord[]
  myDrafts: ActivityRecord[]
}

export const STATUS_LABELS: Record<ActivityStatus, string> = { DRAFT: 'Draft', SUBMITTED: 'Submitted', RETURNED: 'Returned', APPROVED: 'Approved' }

// Mirrors the server's allow-list (evidence.controller.ts) for early feedback only.
export const EVIDENCE_EXTENSIONS = ['.pdf', '.png', '.jpg', '.jpeg', '.xlsx', '.csv']
export const MAX_EVIDENCE_BYTES = 10 * 1024 * 1024

// ---- Calculation engine -------------------------------------------------------------
export interface CalcIssue { code: string; severity: 'BLOCK' | 'WARN'; message: string }
export interface FactorRef { code: string; source: string; sourceVersion: string; numeratorUnit: string; denominatorUnit: string; organizationId?: string | null; tier?: string }

export interface CalcResult {
  id: string
  activityRecordId: string
  formulaCode: string
  line: Line
  status: 'CALCULATED' | 'BLOCKED'
  biogenicTCO2?: string | null
  inputs: { quantity: string; unit?: string; unitEntered: string; convertedTo?: string; convertedQuantity?: string; gridLocation: string | null; regionAsked?: string; regionUsed?: string }
  factorValue: string | null
  tCO2e: string | null
  kgCO2e?: string | null
  inclusionPct: string | null
  issues: CalcIssue[]
  needsConfirmation: boolean
  confirmedAt: string | null
  confirmationReason: string | null
  confirmedBy?: { name: string } | null
  emissionFactor: FactorRef | null
  run?: { id: string; createdAt: string; engineVersion: string }
  facility?: { id: string; name: string; code: string }
  activityRecord?: { id: string; startDate: string; endDate: string; quantity: string; unit: string; emissionSource: { name: string; activityCode?: string | null } }
}

export type Line = 'SCOPE1' | 'SCOPE2_LOCATION' | 'SCOPE2_MARKET' | 'SCOPE2_HEAT' | 'REMOVALS'
export type TotalKey = Line | 'BIOGENIC_MEMO' | 'S1_S2_LOCATION' | 'S1_S2_MARKET'
export const LINE_LABELS: Record<TotalKey, string> = {
  SCOPE1: 'Scope 1',
  SCOPE2_LOCATION: 'Scope 2 electricity, location-based',
  SCOPE2_MARKET: 'Scope 2 electricity, market-based',
  SCOPE2_HEAT: 'Scope 2 steam, heat, cooling',
  S1_S2_LOCATION: 'Scope 1 + 2 (location-based)',
  S1_S2_MARKET: 'Scope 1 + 2 (market-based)',
  BIOGENIC_MEMO: 'Biogenic CO2 (memo)',
  REMOVALS: 'Removals (reported separately)',
}
export interface LineTotal { gross: string; counted: string | null }

export interface CalcRun {
  id: string
  engineVersion: string
  recordCount: number
  calculatedCount: number
  blockedCount: number
  notCalculableCount: number
  scope2LocationTCO2e: string
  scope2LocationBoundaryTCO2e: string | null
  boundaryId: string | null
  totals: Partial<Record<TotalKey, LineTotal>> | null // null for runs made before Scope 1 and market-based existed
  gwpSet: 'AR6' | 'AR5'
  gwpReason: string | null
  createdAt: string
  runBy: { name: string }
  reportingPeriod: { id: string; name: string; startDate: string; endDate: string; status?: 'OPEN' | 'LOCKED'; finalRunId?: string | null }
}

export interface CalcRunDetail {
  run: CalcRun & { boundary: { version: number; approach: 'EQUITY' | 'OPERATIONAL' | 'FINANCIAL' } | null }
  sites: Array<{ facility: { id: string; name: string; code: string }; calculated: number; blocked: number; lines: Record<Line, { tCO2e: string; inclusionPct: string | null; countedTCO2e: string | null } | null> }>
  awaitingConfirmation: number
  tabCounts: Record<Line | 'BLOCKED' | 'ALL', number>
  categories: Partial<Record<SourceCategory, { results: number; blocked: number; toConfirm: number; lines: Partial<Record<TotalKey, { gross: string; counted: string | null }>> }>>
  results: { rows: CalcResult[]; total: number; page: number; pageSize: number }
}

export interface GridRegion { code: string; name: string; country: string; fallbackCode: string | null }
export interface ParamField { name: string; label: string; kind: 'decimal' | 'select' | 'text'; options?: { value: string; label: string }[]; hint?: string }
export interface ActivityTypeRef {
  code: string; name: string; category: string; sourceCategory: SourceCategory | null; allowedUnits: string[]; measuredIn: string
  formulaCode: string | null; calculable: boolean; fields: ParamField[]
  factorShapes?: FactorShape[] // gas and units a library factor for this activity may take (workbook tab 04)
}
export interface FactorShape { gas: string; numeratorUnit: string; denominatorUnit: string }
export interface UnitRef { code: string; name: string; dimension: string }
export type FactorStatus = 'DRAFT' | 'IN_REVIEW' | 'APPROVED' | 'IN_USE' | 'SUPERSEDED'
export interface UnitRequest {
  id: string; activityCode: string | null; unit: string; reason: string; status: 'OPEN' | 'ADDED' | 'DECLINED'; resolution: string | null; createdAt: string; resolvedAt: string | null
  requestedBy: { name: string }; resolvedBy: { name: string } | null; organization: { name: string } | null
}
export interface LibraryUpdate {
  action: 'published' | 'end-dated'; at: string; reason: string | null
  factor: { code: string; activityCode: string | null; gas: string; value: string; numeratorUnit: string; denominatorUnit: string; source: string; sourceVersion: string; validFrom: string; validTo: string | null; activityType: { name: string } | null }
}
export interface EmissionFactor {
  id: string; code: string; activityCode: string | null; gas: string; value: string; numeratorUnit: string; denominatorUnit: string
  source: string; sourceVersion: string; validFrom: string; validTo: string | null; regionCode: string | null; geography: string
  tier: string; notes: string | null; createdAt: string
  activityType: { name: string; formulaCode: string | null } | null; region: { name: string } | null; createdBy: { name: string } | null
  status: FactorStatus; gwpSet: string | null; gwpBasis: string | null; carbonOrigin: string
  organizationId: string | null; organization: { name: string } | null; shared: boolean
  label: string // tier and owner, e.g. "Tenant-defined · Tier 3 site-specific"
  basis: string | null; evidenceName: string | null; approvalNote: string | null; supersedesId: string | null
  createdById: string | null; submittedById: string | null
  usable: boolean; problem: string | null // whether calculations can select it, and why not
  approvedBy: { name: string } | null; approvedAt: string | null
  withdrawnBy: { name: string } | null; withdrawnAt: string | null; withdrawnReason: string | null
}
export interface FuelProperty {
  id: string; facilityId: string; activityCode: string; month: string; version: number; status: 'DRAFT' | 'APPROVED' | 'REJECTED' | 'SUPERSEDED'
  ncv: string | null; density: string | null; densityUnit: string | null; carbonContent: string | null; oxidationFactor: string | null; biogenicShare: string | null
  certificateRef: string; laboratory: string | null; sampleDate: string | null; notes: string | null; evidenceName: string | null; reviewNote: string | null
  createdAt: string; reviewedAt: string | null
  facility: { name: string; code: string }; activityType: { name: string }; createdBy: { name: string }; reviewedBy: { name: string } | null
}

// ---- Period close, reports, verification ---------------------------------------------
export interface ChecklistItem { key: string; label: string; ok: boolean; mandatory: boolean; detail: string }
export interface Checklist {
  period: ReportingPeriod & { lockedAt: string | null; finalRunId: string | null }
  run: { id: string; createdAt: string } | null
  items: ChecklistItem[]
  canLock: boolean
  events: Array<{ id: string; action: 'LOCKED' | 'REOPENED'; reason: string | null; runId: string | null; createdAt: string; actor: { name: string } }>
}

export interface ReportRecord {
  resultId: string; recordId: string; facility: string; source: string; activityCode: string | null; startDate: string; endDate: string
  quantity: string; unit: string; formulaCode: string; line: Line; status: 'CALCULATED' | 'BLOCKED'; tCO2e: string | null; biogenicTCO2: string | null
  inclusionPct: string | null; issues: CalcIssue[]; confirmedBy: string | null; confirmedAt: string | null; confirmationReason: string | null
}
export interface Report {
  organization: { name: string; legalName: string | null }
  period: { id: string; name: string; startDate: string; endDate: string; status: 'OPEN' | 'LOCKED'; lockedAt: string | null }
  status: 'FINAL' | 'PROVISIONAL'
  run: { id: string; createdAt: string; runBy: string; engineVersion: string; notCalculableCount: number }
  filter: { facilityId: string | null; scope: 'all' | '1' | '2'; from: string | null; to: string | null }
  boundary: { version: number; approach: 'EQUITY' | 'OPERATIONAL' | 'FINANCIAL'; effectiveFrom: string } | null
  gwpSet: string
  gwpReason: string | null
  lineLabels: Record<TotalKey, string>
  totals: Partial<Record<TotalKey, LineTotal>>
  facilities: Array<{ facility: { id: string; name: string; code: string }; shares: Partial<Record<Line, string | null>>; totals: Partial<Record<TotalKey, LineTotal>> }>
  gases: Record<string, string>
  methodology: Array<{ formulaCode: string; title: string }>
  factors: Array<{ code: string; activityCode: string | null; gas: string; value: string; numeratorUnit: string; denominatorUnit: string; source: string; sourceVersion: string; tier: string; validFrom: string; validTo: string | null; organizationId: string | null; status: string }>
  blocked: ReportRecord[]
  warnings: ReportRecord[]
  records: ReportRecord[]
}

export interface VerifierGrant { id: string; user: { id: string; name: string; email: string }; reportingPeriod: { id: string; name: string }; grantedBy: { name: string }; createdAt: string }
export type QueryStatus = 'OPEN' | 'ANSWERED' | 'CLOSED'
export interface VerificationQuery {
  id: string; subject: string; status: QueryStatus; createdAt: string; updatedAt: string; closedAt: string | null
  reportingPeriod: { id: string; name: string }
  activityRecord: { id: string; startDate: string; endDate: string; emissionSource: { name: string }; facility: { name: string } } | null
  raisedBy: { name: string }
  _count?: { messages: number }
  messages?: Array<{ id: string; body: string; createdAt: string; author: { name: string } }>
}

export interface PeriodAttention {
  period: { id: string; name: string }
  counts: { draft: number; submitted: number; returned: number; approved: number; blocked: number; unconfirmed: number; notCalculable: number }
  current: boolean
  run: { id: string; createdAt: string } | null
  canLock: boolean
  open: Array<{ key: string; label: string; detail: string; mandatory: boolean }>
}
export interface Attention { periods: PeriodAttention[]; unresolvedSources: Array<{ id: string; name: string; facility: { code: string } }> }

export interface PeriodPreview {
  period: { id: string; name: string; startDate: string; endDate: string; status: 'OPEN' | 'LOCKED' }
  categories: Array<{
    category: SourceCategory
    counts: Record<ActivityStatus, number>
    estimate: Partial<Record<Line, string>>
    records: Array<{
      id: string; status: ActivityStatus; facility: string; source: string; activity: string | null; startDate: string; endDate: string
      quantity: string; unit: string; calculable: boolean
      results: Array<{ formulaCode: string; line: Line; status: 'CALCULATED' | 'BLOCKED'; tCO2e: string | null; biogenicTCO2: string | null; issues: CalcIssue[] }>
    }>
  }>
}
