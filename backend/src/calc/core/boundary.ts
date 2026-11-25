// Share of a facility counted under an approved boundary (workbook tab 09 G-02; the boundary page
// states 0% facilities are not counted in Scope 1 or Scope 2 totals).
export interface BoundaryFacility {
  id: string; equityShare: number | null; operationalControl: boolean | null; financialControl: boolean | null
  scope1Active: boolean; scope2Active: boolean
}
export type Approach = 'EQUITY' | 'OPERATIONAL' | 'FINANCIAL'

export function sharePct(approach: Approach, scope: 1 | 2, f: BoundaryFacility | undefined): number | null {
  if (!f) return null
  if (!(scope === 1 ? f.scope1Active : f.scope2Active)) return 0
  if (approach === 'EQUITY') return f.equityShare
  const control = approach === 'OPERATIONAL' ? f.operationalControl : f.financialControl
  return control == null ? null : control ? 100 : 0
}
