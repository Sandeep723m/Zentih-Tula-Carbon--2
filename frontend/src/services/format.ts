// Display rounding from workbook tab 08. Stored values stay unrounded; only the screen rounds.
const fixed = (v: string | number, dp: number) =>
  Number(v).toLocaleString(undefined, { minimumFractionDigits: dp, maximumFractionDigits: dp })

export const recordT = (v: string | null) => (v == null ? '—' : fixed(v, 3)) // R-04: per record, 3 dp
export const siteT = (v: string | null) => (v == null ? '—' : fixed(v, 2)) // R-05: site total, 2 dp
export const orgT = (v: string | null) => (v == null ? '—' : fixed(v, Math.abs(Number(v)) > 1000 ? 0 : 2)) // R-06
export const plain = (v: string | null) => (v == null ? '—' : Number(v).toLocaleString(undefined, { maximumFractionDigits: 15 }))
// Dates read as "1 Jul 2024". The date part is taken as-is (UTC), so no time zone can shift the day.
const DATE = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' })
// For date inputs and API values: always YYYY-MM-DD.
export const isoDay = (iso: string | null) => (iso ? iso.slice(0, 10) : '')
export const day = (iso: string | null) => (iso ? DATE.format(new Date(iso.slice(0, 10))) : '—')
// "1 Apr – 30 Jun 2024", or both years when they differ, or a single day.
export function dateRange(from: string, to: string) {
  if (from.slice(0, 10) === to.slice(0, 10)) return day(from)
  const a = day(from), b = day(to)
  return from.slice(0, 4) === to.slice(0, 4) ? `${a.slice(0, -5)} – ${b}` : `${a} – ${b}`
}

// Messages for people, not auditors: drops internal references such as "(V-07)", "(tab 05 rule 3)", "rule 12".
export const humanize = (m: string) => m
  .replace(/\s*\((?:[A-Z]-\d{2}[a-z]?|[Tt]abs? \d+|[Rr]ules? \d+)[^)]*\)/g, '')
  .replace(/\s*\b[Tt]ab \d{2}\b(?: rules? \d+(?: and \d+)?)?:?/g, '')
  .replace(/\s+([.,;])/g, '$1')
  .trim()

// Reference-data notes carry internal review remarks; customers see only the factor guidance.
const NOTE_REWRITES: Array<[RegExp, string]> = [
  [/\s*Secondary-source figure[^;]*; confirm against [^.]*\./g, ''],
  [/For non-India sites, the national grid factor .*$/, 'For sites outside India, the national grid factor of that country applies.'],
  [/(reported as a |: )?memo item, not in( the)?/g, ' reported separately and not included in the'],
  [/Biogenic CO2 reported as a memo item\./, 'Biogenic CO2 is reported separately.'],
  [/Previous-year version, kept so reports for (\S+) reproduce\./, 'Previous-year factor, retained so $1 reports remain consistent.'],
  [/Regional values to be loaded from/, 'Regional values follow the'],
  [/[^.]*\b(Seed value|before release|Value to be supplied|Left blank|Secondary-source|confirm against|none seeded|default seeded)\b[^.]*\.\s*/gi, ''],
  [/Engine falls back to the grid average with disclosure, pending [A-Z]-\d+\./, 'The grid average is used instead and disclosed in the report.'],
  [/; otherwise fail/, ''],
  [/\s*—\s*see tab \d+\./, '.'],
]
export const factorNote = (n: string) => humanize(NOTE_REWRITES.reduce((s, [re, to]) => s.replace(re, to), n))

// Tier and owner of a factor, wherever it appears (TC-ARC-006 2.1).
export const factorLabel = (f: { organizationId?: string | null; tier: string }) => `${f.organizationId ? 'Tenant-defined' : 'Platform library'} · ${f.tier}`

// What a result actually applied, read from its snapshotted inputs: an own CO2 factor replaces the library one for CO2,
// so the library factor is then named only as the default it replaced.
export function appliedValues(inputs: unknown): { ownCO2?: string; parts: string[] } {
  const i = (inputs ?? {}) as Record<string, unknown>
  const n = (v: unknown) => Number(v).toLocaleString(undefined, { maximumFractionDigits: 6 })
  const parts: string[] = []
  if (i.ncvUsed) parts.push(`NCV ${n(i.ncvUsed)} TJ/t (${i.ncvSource ?? 'default'})`)
  if (i.carbonOrigin) parts.push(`carbon origin ${String(i.carbonOrigin).toLowerCase()}${i.biogenicShare ? `, ${n(Number(i.biogenicShare) * 100)}% biogenic` : ''}`)
  const ownCO2 = i.co2FactorUsed ? `${n(i.co2FactorUsed)} kg CO2/TJ${i.co2FactorSource ? ` (${i.co2FactorSource})` : ''}` : undefined
  return { ownCO2, parts }
}

// Customer-facing name of the calculation method version stored on a run.
export const methodName = (v: string) => v.replace(/^TC-DOM-\S+\s*/, 'Tula Carbon method ')
