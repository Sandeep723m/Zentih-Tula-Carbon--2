import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDialog } from '../components/Dialog'
import FieldsForm from '../components/FieldsForm'
import { apiPost, apiPut } from '../services/apiClient'
import type { GridRegion } from '../types/api'
import { useLoad } from '../hooks/useLoad'
import { Skeleton } from '../components/Page'
import { Notify } from '../components/Toast'

// ── types ─────────────────────────────────────────────────────────────────────
type Approach = 'EQUITY' | 'OPERATIONAL' | 'FINANCIAL'

interface FacilityRow {
  id: string; name: string; code: string; country: string | null; isActive: boolean
  gridLocation: string | null; equityShare: number | null
  operationalControl: boolean | null; financialControl: boolean | null
  scope1Active: boolean; scope2Active: boolean
}

interface BoundaryState {
  id?: string; version?: number; approach?: Approach
  status?: 'DRAFT' | 'APPROVED'
  effectiveFrom?: string; baseYear?: number
  approvedAt?: string; changeReason?: string
  approvedBy?: { id: string; name: string }
  snapshot?: Omit<FacilityRow, 'isActive'>[] | null
}

interface BoundaryData {
  org: { id: string; name: string; baseYear: number | null; fiscalYearStartMonth?: number }
  boundary: BoundaryState | null
  facilities: FacilityRow[]
}

function ScopeToggle({ checked, disabled, onChange }: { checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" className={`toggle ${checked ? 'toggle--on' : ''}`} aria-pressed={checked} disabled={disabled} onClick={() => !disabled && onChange(!checked)}>
      <span className="toggle__dot" />
      {checked ? 'Yes' : 'No'}
    </button>
  )
}

// ── constants ─────────────────────────────────────────────────────────────────
const APPROACHES: Record<Approach, { label: string; field: string; lead: string; use: string; viz: [string, string, number][] }> = {
  EQUITY: {
    label: 'Equity Share',
    field: 'Equity Share %',
    lead: 'Count emissions in proportion to what we own.',
    use: 'Suits investor and financial reporting, where ownership matters.',
    viz: [['Subsidiary', '80% owned', 80], ['Joint venture', '50% stake', 50], ['Minority stake', '25% owned', 25]],
  },
  OPERATIONAL: {
    label: 'Operational Control',
    field: 'Operational Control',
    lead: 'Count 100% of facilities where we set the operating policies, 0% otherwise.',
    use: 'Suits reduction planning — you count what you can change. The most common choice.',
    viz: [['Subsidiary', 'we run it', 100], ['Joint venture', 'we run it', 100], ['Minority stake', '25% owned', 0]],
  },
  FINANCIAL: {
    label: 'Financial Control',
    field: 'Financial Control',
    lead: 'Count 100% of facilities whose financial and operating policies we direct, 0% otherwise.',
    use: 'Suits companies that follow their accounting consolidation.',
    viz: [['Subsidiary', '80% owned', 100], ['Joint venture', 'partner runs it', 0], ['Minority stake', '25% owned', 0]],
  },
}


function inclusionPct(f: FacilityRow, approach: Approach | undefined): number | null {
  if (!approach) return null
  if (approach === 'EQUITY') {
    if (f.equityShare == null) return null
    return f.equityShare
  }
  const v = approach === 'OPERATIONAL' ? f.operationalControl : f.financialControl
  if (v == null) return null
  return v ? 100 : 0
}

function facilityStatus(f: FacilityRow, approach: Approach | undefined): string {
  if (!f.name.trim()) return 'Missing name'
  if (!f.scope1Active && !f.scope2Active) return 'Pick at least one scope'
  if (f.scope2Active && !f.gridLocation) return 'Missing grid location'
  if (!approach) return 'OK'
  if (approach === 'EQUITY') {
    if (f.equityShare == null) return 'Missing Equity Share %'
    if (f.equityShare < 0 || f.equityShare > 100) return 'Equity Share % must be 0–100'
  } else if (approach === 'OPERATIONAL') {
    if (f.operationalControl == null) return 'Missing Operational Control'
  } else {
    if (f.financialControl == null) return 'Missing Financial Control'
  }
  return 'OK'
}

// ── Pie mini-chart ─────────────────────────────────────────────────────────────
function Pie({ pct }: { pct: number }) {
  const r = 9.5, c = 2 * Math.PI * r, d = (Math.max(0, Math.min(100, pct)) / 100) * c
  return (
    <svg className="approach__pie" width="44" height="44" viewBox="0 0 44 44" aria-hidden="true">
      <circle cx="22" cy="22" r="19" fill="#fff" stroke="var(--color-border-strong)" strokeWidth="2" />
      <circle cx="22" cy="22" r={r} fill="none" stroke="var(--color-primary)" strokeWidth={r * 2}
        strokeDasharray={`${d.toFixed(2)} ${c.toFixed(2)}`} transform="rotate(-90 22 22)" />
    </svg>
  )
}

// ── Step components ────────────────────────────────────────────────────────────
function StepNav({ step, canGo, setStep }: { step: number; canGo: (n: number) => boolean; setStep: (n: number) => void }) {
  const steps = [
    { t: 'Boundary approach', s: 'How emissions are consolidated' },
    { t: 'Facilities & scopes', s: 'List facilities, set scopes' },
    { t: 'Review & approve', s: 'Check, download, lock' },
  ]
  return (
    <ol className="stepper">
      {steps.map((s, i) => {
        const n = i + 1, cur = step === n, done = n < step
        return (
          <li key={n}>
            <button type="button" className={`stepper__button ${done ? 'stepper__button--done' : ''}`} disabled={!canGo(n)} aria-current={cur ? 'step' : undefined} onClick={() => canGo(n) && setStep(n)}>
              <span className="stepper__num">{done ? '✓' : n}</span>
              <span>
                <span className="stepper__title">{s.t}</span>
                <span className="stepper__sub">{s.s}</span>
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  )
}

// ── Step 1: Approach ──────────────────────────────────────────────────────────
function Step1Approach({
  approach, setApproach, locked, onNext,
}: { approach: Approach | undefined; setApproach: (a: Approach) => void; locked: boolean; onNext: () => void }) {
  return (
    <section className="card">
      <h2 className="card__title">Choose the boundary approach</h2>
      <p className="muted">Pick one. It decides how much of each facility's emissions count for Scope 1 and Scope 2.</p>
      <div className="approaches">
        {(Object.keys(APPROACHES) as Approach[]).map((key) => {
          const a = APPROACHES[key]
          const selected = approach === key
          return (
            <label key={key} className={`approach ${selected ? 'approach--selected' : ''} ${locked ? 'approach--locked' : ''}`}>
              <input className="approach__radio" type="radio" name="approach" value={key} checked={selected} disabled={locked} onChange={() => setApproach(key)} />
              <strong className="approach__title">{a.label}</strong>
              <p className="approach__lead">{a.lead}</p>
              <div className="approach__viz">
                {a.viz.map(([name, desc, pct]) => (
                  <figure key={name} className="approach__fig">
                    <Pie pct={pct} />
                    <figcaption className="approach__cap">
                      <b className="approach__pct">{pct}% counted</b>
                      {name}<br />{desc}
                    </figcaption>
                  </figure>
                ))}
              </div>
              <p className="approach__use">{a.use}</p>
            </label>
          )
        })}
      </div>
      {approach && (
        <p className="status status--warn">
          <span>With <strong>{APPROACHES[approach].label}</strong>, every facility must have <strong>{APPROACHES[approach].field}</strong> filled in.</span>
        </p>
      )}
      <div className="actions actions--end">
        <button className="button" disabled={!approach} onClick={onNext}>Next, add facilities →</button>
      </div>
    </section>
  )
}

// ── Step 2: Facilities ────────────────────────────────────────────────────────
function Step2Facilities({
  facilities, approach, locked,
  onFacilityChange, onAddFacility, onBack, onNext,
}: {
  facilities: FacilityRow[]; approach: Approach | undefined; locked: boolean
  onFacilityChange: (id: string, patch: Partial<FacilityRow>) => void
  onAddFacility: (values: Record<string, unknown>) => Promise<void>
  onBack: () => void; onNext: () => void
}) {
  const grids = useLoad<GridRegion[]>('/api/reference/grid-regions').data ?? []
  const [adding, setAdding] = useState(false)
  const issues = facilities.filter(f => facilityStatus(f, approach) !== 'OK').length

  return (
    <section className="card">
      <div className="card__headline card__headline--top">
        <div className="stack stack--xs">
          <h2 className="card__title">Facilities &amp; scopes</h2>
          <p className="muted">Set the boundary fields for each facility. The share counted is calculated automatically.</p>
        </div>
        {!locked && !adding && <button className="button button--small" onClick={() => setAdding(true)}>+ Add facility</button>}
      </div>

      {adding && (
        <div className="card card--muted">
          <h3 className="card__subtitle">New facility</h3>
          <FieldsForm
            fields={[
              { name: 'name', label: 'Name', required: true },
              { name: 'code', label: 'Code (unique in this organisation)', required: true },
              { name: 'country', label: 'Country' },
              { name: 'city', label: 'City' },
            ]}
            initial={{ name: '', code: '', country: '', city: '' }}
            submitLabel="Add facility"
            onSubmit={async (v) => { await onAddFacility(v); setAdding(false) }}
            onCancel={() => setAdding(false)}
          />
        </div>
      )}

      {facilities.length === 0 && !adding && (
        <div className="empty-state">
          <p>This organisation has no facilities yet. Add each site whose emissions belong in the boundary.</p>
          {!locked && <button className="button" onClick={() => setAdding(true)}>+ Add the first facility</button>}
        </div>
      )}

      <div className="badges">
        {[
          `${facilities.length} facilities`,
          `${facilities.filter(f => f.scope1Active).length} with Scope 1`,
          `${facilities.filter(f => f.scope2Active).length} with Scope 2`,
        ].map(t => <span key={t} className="badge badge--lg">{t}</span>)}
        <span className={`badge badge--lg ${issues ? 'badge--error' : 'badge--success'}`}>{issues ? `${issues} with issues` : '✓ All valid'}</span>
      </div>

      <div className="table-wrap table-wrap--bordered">
        <table className="table table--compact boundary-table">
          <thead>
            <tr>
              <th>Facility</th>
              <th>Country</th>
              <th className="col-key">
                {approach ? APPROACHES[approach].field : 'Approach field'}
                <span className="th__hint">{approach === 'EQUITY' ? '0 to 100' : 'Yes or No'}</span>
              </th>
              <th>Scope 1</th>
              <th>Scope 2</th>
              <th>Grid location<span className="th__hint">If Scope 2 applies</span></th>
              <th className="col-auto">Share counted</th>
              <th className="col-auto">Status</th>
            </tr>
          </thead>
          <tbody>
            {facilities.map((f) => {
              const inc = inclusionPct(f, approach)
              const st = facilityStatus(f, approach)
              const control = approach === 'OPERATIONAL' ? f.operationalControl : f.financialControl
              return (
                <tr key={f.id}>
                  <td><span className="strong">{f.name}</span><span className="cell-sub">{f.code}</span></td>
                  <td>{f.country ?? '—'}</td>
                  <td>
                    {!approach ? '—' : approach === 'EQUITY' ? (
                      <input type="number" min={0} max={100} step={0.01} disabled={locked}
                        className={`input input--sm boundary-input--pct ${f.equityShare == null ? 'input--invalid' : ''}`}
                        value={f.equityShare ?? ''} placeholder="0–100"
                        onChange={e => onFacilityChange(f.id, { equityShare: e.target.value === '' ? null : Number(e.target.value) })} />
                    ) : (
                      <select disabled={locked} className={`input input--sm ${control == null ? 'input--invalid' : ''}`}
                        value={control == null ? '' : control ? 'yes' : 'no'}
                        onChange={e => {
                          const v = e.target.value === '' ? null : e.target.value === 'yes'
                          onFacilityChange(f.id, approach === 'OPERATIONAL' ? { operationalControl: v } : { financialControl: v })
                        }}>
                        <option value="">Select</option>
                        <option value="yes">Yes</option>
                        <option value="no">No</option>
                      </select>
                    )}
                  </td>
                  <td>
                    <ScopeToggle checked={f.scope1Active} disabled={locked}
                      onChange={v => onFacilityChange(f.id, { scope1Active: v })} />
                  </td>
                  <td>
                    <ScopeToggle checked={f.scope2Active} disabled={locked}
                      onChange={v => onFacilityChange(f.id, { scope2Active: v, gridLocation: v ? f.gridLocation : null })} />
                  </td>
                  <td>
                    {f.scope2Active ? (
                      <select disabled={locked} value={f.gridLocation ?? ''}
                        className={`input input--sm boundary-input--grid ${!f.gridLocation ? 'input--invalid' : ''}`}
                        onChange={e => onFacilityChange(f.id, { gridLocation: e.target.value || null })}>
                        <option value="">Select</option>
                        {grids.map(g => <option key={g.code} value={g.name}>{g.name}</option>)}
                      </select>
                    ) : <span className="muted text-sm">Not needed</span>}
                  </td>
                  <td className="num strong">{inc != null ? `${inc}%` : '—'}</td>
                  <td><span className={`facility-status ${st === 'OK' ? 'text-success' : 'text-error'}`}>{st}</span></td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="muted text-sm">
        Scope 1 = direct emissions (fuel, fleet, refrigerants). Scope 2 = purchased electricity, heat, steam — needs a grid location.
        A facility at 0% stays in the list but its emissions are not counted in totals.
      </p>
      <div className="actions actions--between">
        <button className="button button--ghost" onClick={onBack}>← Back</button>
        <button className="button" onClick={onNext}>Next, review →</button>
      </div>
    </section>
  )
}

// ── Step 3: Review & Approve ──────────────────────────────────────────────────
function Step3Review({
  org, boundary, facilities, approach, baseYear, effectiveFrom, locked,
  saving, onBack, onSaveAndApprove,
}: {
  org: { id: string; name: string }
  boundary: BoundaryState | null
  facilities: FacilityRow[]
  approach: Approach | undefined
  baseYear: string; effectiveFrom: string; locked: boolean
  saving: boolean
  onBack: () => void
  onSaveAndApprove: () => void
}) {
  const issues = facilities.filter(f => facilityStatus(f, approach) !== 'OK').length
  const ready = !!approach && !!baseYear && !!effectiveFrom && issues === 0 && facilities.length > 0

  const checks = [
    { ok: !!approach, t: 'Boundary approach is chosen' },
    { ok: !!baseYear && !isNaN(Number(baseYear)), t: 'Base year is set' },
    { ok: !!effectiveFrom, t: 'Effective from date is set' },
    { ok: facilities.length > 0, t: 'At least one facility is listed' },
    { ok: facilities.length > 0 && issues === 0, t: issues ? `${issues} facilit${issues === 1 ? 'y has' : 'ies have'} issues to fix` : 'Every facility passes validation' },
  ]

  const downloadCsv = () => {
    const header = ['Facility ID', 'Facility Name', 'Country', 'Scope 1', 'Scope 2', 'Grid Location', 'Equity Share %', 'Operational Control', 'Financial Control', 'Share Counted', 'Status']
    const rows = facilities.map(f => {
      const inc = inclusionPct(f, approach)
      return [f.code, f.name, f.country ?? '', f.scope1Active ? 'Yes' : 'No', f.scope2Active ? 'Yes' : 'No', f.gridLocation ?? '', approach === 'EQUITY' ? (f.equityShare ?? '') : '', approach === 'OPERATIONAL' ? (f.operationalControl == null ? '' : f.operationalControl ? 'Yes' : 'No') : '', approach === 'FINANCIAL' ? (f.financialControl == null ? '' : f.financialControl ? 'Yes' : 'No') : '', inc != null ? inc + '%' : '', facilityStatus(f, approach)]
    })
    const safe = (v: unknown) => { const s = String(v); return /^[=+\-@\t\r]/.test(s) && !/^[-+]?\d+(\.\d+)?$/.test(s) ? `'${s}` : s } // no spreadsheet formulas
    const csv = '﻿' + [header, ...rows].map(r => r.map(v => { const s = safe(v); return /[,"\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }).join(',')).join('\r\n')
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `TulaCarbon_${org.name.replace(/[^A-Za-z0-9]+/g, '_')}_facilities.csv`
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }

  const downloadJson = () => {
    const out = {
      organization: { name: org.name, base_year: Number(baseYear) },
      boundary: { approach, effective_from: effectiveFrom, version: boundary?.version ?? 1, status: locked ? 'APPROVED' : 'DRAFT', approved_at: boundary?.approvedAt ?? null },
      facilities: facilities.map(f => ({ facility_id: f.code, facility_name: f.name, country: f.country, grid_location: f.scope2Active ? f.gridLocation : null, equity_share: approach === 'EQUITY' ? f.equityShare : null, operational_control: approach === 'OPERATIONAL' ? f.operationalControl : null, financial_control: approach === 'FINANCIAL' ? f.financialControl : null, scope1_active: f.scope1Active, scope2_active: f.scope2Active, inclusion_pct: inclusionPct(f, approach), status: facilityStatus(f, approach) })),
    }
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: 'application/json' }))
    a.download = `TulaCarbon_${org.name.replace(/[^A-Za-z0-9]+/g, '_')}_boundary.json`
    document.body.appendChild(a); a.click(); setTimeout(() => { URL.revokeObjectURL(a.href); a.remove() }, 500)
  }

  return (
    <section className="card">
      <h2 className="card__title">{locked ? `Approved boundary — version ${boundary?.version}` : 'Review & approve'}</h2>

      <dl className="summary">
        {[['Organisation', org.name], ['Approach', approach ? APPROACHES[approach].label : '—'], ['Base year', baseYear || '—'], ['Effective from', effectiveFrom || '—']].map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>

      {!locked && (
        <div className="stack stack--sm">
          <h3 className="card__subtitle">Readiness</h3>
          <ul className="checklist">
            {checks.map(c => (
              <li key={c.t} className={`checklist__item ${c.ok ? 'checklist__item--ok' : ''}`}><span className="checklist__dot" />{c.t}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="stack stack--sm">
        <h3 className="card__subtitle">Facilities ({facilities.length})</h3>
        <div className="table-wrap table-wrap--bordered">
          <table className="table table--compact boundary-table boundary-table--review">
            <thead>
              <tr>
                {['Facility', 'Country', 'Scopes', approach ? APPROACHES[approach].field : 'Approach field', 'Share counted', 'Status'].map(h => <th key={h}>{h}</th>)}
              </tr>
            </thead>
            <tbody>
              {facilities.map(f => {
                const inc = inclusionPct(f, approach)
                const st = facilityStatus(f, approach)
                const val = approach === 'EQUITY' ? (f.equityShare != null ? f.equityShare + '%' : '—') : approach === 'OPERATIONAL' ? (f.operationalControl == null ? '—' : f.operationalControl ? 'Yes' : 'No') : approach === 'FINANCIAL' ? (f.financialControl == null ? '—' : f.financialControl ? 'Yes' : 'No') : '—'
                return (
                  <tr key={f.id}>
                    <td><strong>{f.name}</strong> <span className="muted text-xs">{f.code}</span></td>
                    <td>{f.country ?? '—'}</td>
                    <td>{[f.scope1Active && 'Scope 1', f.scope2Active && 'Scope 2'].filter(Boolean).join(', ') || '—'}</td>
                    <td>{val}</td>
                    <td className="num strong">{inc != null ? `${inc}%` : '—'}</td>
                    <td><span className={`facility-status ${st === 'OK' ? 'text-success' : 'text-error'}`}>{st}</span></td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        <p className="muted text-sm">A facility at 0% stays in the list but is not counted in Scope 1 or Scope 2 totals.</p>
      </div>
      <div className="actions">
        <button className="button button--ghost button--small" onClick={downloadCsv}>↓ Download facilities (CSV)</button>
        <button className="button button--ghost button--small" onClick={downloadJson}>↓ Download setup (JSON)</button>
      </div>
      <div className="actions actions--between actions--divided">
        <button className="button button--ghost" onClick={onBack}>← Back</button>
        {!locked && <button className="button" disabled={!ready || saving} onClick={onSaveAndApprove}>{saving ? 'Saving…' : 'Approve & lock boundary'}</button>}
      </div>
    </section>
  )
}

// ── Versions ──────────────────────────────────────────────────────────────────
function VersionBar({ boundary, versionCount, saving, showHistory, onToggleHistory, onNewVersion }: {
  boundary: BoundaryState | null; versionCount: number; saving: boolean
  showHistory: boolean; onToggleHistory: () => void; onNewVersion: () => void
}) {
  const approved = boundary?.status === 'APPROVED'
  return (
    <div className={`card version-bar ${approved ? 'card--success' : boundary ? 'card--warning' : ''}`}>
      <div className="version-bar__main">
        {boundary ? (
          <>
            <div className="cluster"><strong>Version {boundary.version}</strong><span className="badge">{approved ? 'Approved · locked' : 'Draft · editable'}</span></div>
            <p className="version-bar__meta">
              {approved
                ? `Approved ${new Date(boundary.approvedAt!).toLocaleString()}${boundary.approvedBy ? ` by ${boundary.approvedBy.name}` : ''}. To change anything, create a new version.`
                : 'Not approved yet. Finish the steps below and approve it in step 3.'}
              {boundary.changeReason && <> · Reason: {boundary.changeReason}</>}
            </p>
          </>
        ) : (
          <>
            <strong>No boundary yet</strong>
            <p className="version-bar__meta">Complete the three steps and approve to create version 1.</p>
          </>
        )}
      </div>
      {versionCount > 0 && (
        <button className="button button--ghost button--small" aria-expanded={showHistory} onClick={onToggleHistory}>
          {showHistory ? 'Hide version history' : `Version history (${versionCount})`}
        </button>
      )}
      {approved && <button className="button button--small" disabled={saving} onClick={onNewVersion}>Create new version</button>}
    </div>
  )
}

type Snap = Omit<FacilityRow, 'isActive'>
interface VersionView { version: number; status: string; approach?: Approach; baseYear?: number; effectiveFrom?: string; facilities: Snap[] | null }

const FIELDS: Array<[keyof Snap, string]> = [
  ['name', 'Name'], ['country', 'Country'], ['equityShare', 'Equity share %'], ['operationalControl', 'Operational control'],
  ['financialControl', 'Financial control'], ['scope1Active', 'Scope 1'], ['scope2Active', 'Scope 2'], ['gridLocation', 'Grid location'],
]
const show = (v: unknown) => v == null || v === '' ? '—' : v === true ? 'Yes' : v === false ? 'No' : String(v)

function diffVersions(prev: VersionView, cur: VersionView) {
  const settings = ([
    ['Approach', prev.approach && APPROACHES[prev.approach].label, cur.approach && APPROACHES[cur.approach].label],
    ['Base year', prev.baseYear, cur.baseYear],
    ['Effective from', prev.effectiveFrom?.slice(0, 10), cur.effectiveFrom?.slice(0, 10)],
  ] as const).filter(([, a, b]) => show(a) !== show(b))
  const before = new Map((prev.facilities ?? []).map(f => [f.id, f]))
  const after = new Map((cur.facilities ?? []).map(f => [f.id, f]))
  const added = [...after.values()].filter(f => !before.has(f.id))
  const removed = [...before.values()].filter(f => !after.has(f.id))
  const changed = [...after.values()].flatMap(f => {
    const old = before.get(f.id)
    if (!old) return []
    const fields = FIELDS.filter(([k]) => show(old[k]) !== show(f[k])).map(([k, label]) => ({ label, from: show(old[k]), to: show(f[k]) }))
    return fields.length ? [{ name: f.name, fields }] : []
  })
  return { settings, added, removed, changed }
}

function VersionHistory({ versions, draftFacilities, draftSettings }: {
  versions: BoundaryState[]
  draftFacilities: FacilityRow[] | null
  draftSettings: { approach?: Approach; baseYear?: number; effectiveFrom?: string }
}) {
  const views: VersionView[] = versions.map(v => v.status === 'DRAFT'
    ? { version: v.version!, status: 'DRAFT', ...draftSettings, facilities: draftFacilities }
    : { version: v.version!, status: v.status!, approach: v.approach, baseYear: v.baseYear, effectiveFrom: v.effectiveFrom, facilities: v.snapshot ?? null })
  const [selected, setSelected] = useState<{ version: number; mode: 'view' | 'compare' } | null>(null)
  const cur = views.find(v => v.version === selected?.version)
  const prev = cur && views.find(v => v.version === cur.version - 1)

  return (
    <section className="card">
      <h2 className="card__title">Version history</h2>
      <p className="muted">
        Approved versions are frozen: their values never change. Only the latest version is used; older ones are kept for audit.
      </p>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Version</th><th>Status</th><th>Approach</th><th>Base year</th><th>Effective from</th><th>Approved</th><th>Reason</th><th aria-label="Actions" /></tr></thead>
          <tbody>
            {versions.map((v, i) => (
              <tr key={v.id} className={selected?.version === v.version ? 'is-selected' : undefined}>
                <td><strong>v{v.version}</strong>{i === 0 && ' (latest)'}</td>
                <td>{v.status === 'APPROVED' ? 'Approved' : 'Draft'}</td>
                <td>{v.approach ? APPROACHES[v.approach].label : '—'}</td>
                <td>{v.baseYear ?? '—'}</td>
                <td>{v.effectiveFrom?.slice(0, 10) ?? '—'}</td>
                <td>{v.approvedAt ? `${new Date(v.approvedAt).toLocaleDateString()}${v.approvedBy ? ` · ${v.approvedBy.name}` : ''}` : '—'}</td>
                <td>{v.changeReason ?? (v.version === 1 ? 'Initial boundary' : '—')}</td>
                <td className="nowrap">
                  <button className="link link--button" onClick={() => setSelected({ version: v.version!, mode: 'view' })}>View</button>
                  {v.version! > 1 && <> · <button className="link link--button" onClick={() => setSelected({ version: v.version!, mode: 'compare' })}>Changes vs v{v.version! - 1}</button></>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {cur && selected?.mode === 'view' && (
        <div className="stack stack--sm">
          <h3 className="card__subtitle">Version {cur.version} ({cur.status === 'DRAFT' ? 'draft, including unsaved edits' : 'as approved'})</h3>
          {cur.facilities == null ? <p className="status">Facility details were not recorded for this version.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Facility</th>{FIELDS.slice(1).map(([, l]) => <th key={l}>{l}</th>)}<th>Share counted</th></tr></thead>
                <tbody>
                  {cur.facilities.map(f => {
                    const inc = inclusionPct({ ...f, isActive: true }, cur.approach)
                    return (
                      <tr key={f.id}><td><strong>{f.name}</strong> <span className="muted text-xs">{f.code}</span></td>
                        {FIELDS.slice(1).map(([k, l]) => <td key={l}>{show(f[k])}</td>)}<td>{inc != null ? `${inc}%` : '—'}</td></tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {cur && prev && selected?.mode === 'compare' && (() => {
        if (cur.facilities == null || prev.facilities == null) return <p className="status">These versions can't be compared because facility details were not recorded for one of them.</p>
        const d = diffVersions(prev, cur)
        const none = !d.settings.length && !d.added.length && !d.removed.length && !d.changed.length
        return (
          <div className="stack stack--sm">
            <h3 className="card__subtitle">Changes from v{prev.version} to v{cur.version}{cur.status === 'DRAFT' && ' (draft)'}</h3>
            {none && <p className="status">No differences.</p>}
            <ul className="plain plain--stack">
              {d.settings.map(([label, a, b]) => <li key={label}>✎ <strong>{label}</strong>: {show(a)} → {show(b)}</li>)}
              {d.added.map(f => <li key={f.id} className="text-success">＋ Added <strong>{f.name}</strong> ({f.code})</li>)}
              {d.removed.map(f => <li key={f.id} className="text-error">− Removed <strong>{f.name}</strong> ({f.code})</li>)}
              {d.changed.map(c => (
                <li key={c.name}>✎ <strong>{c.name}</strong>: {c.fields.map(x => `${x.label} ${x.from} → ${x.to}`).join('; ')}</li>
              ))}
            </ul>
          </div>
        )
      })()}
    </section>
  )
}

// The base year follows the organisation's fiscal year: 2024 with an April start is FY 2024-25 (Apr 2024 to Mar 2025).
function fiscalYearLabel(year: number, startMonth: number) {
  const m = (i: number) => new Date(2000, i - 1, 1).toLocaleString('en', { month: 'short' })
  if (startMonth === 1) return `Calendar year ${year} (Jan to Dec ${year})`
  const end = startMonth - 1
  return `FY ${year}-${String(year + 1).slice(2)} (${m(startMonth)} ${year} to ${m(end)} ${year + 1})`
}

// ── Main page ─────────────────────────────────────────────────────────────────
export default function BoundarySetupPage() {
  const { id } = useParams<{ id: string }>()
  const { data, error, reload } = useLoad<BoundaryData>(`/api/platform/organizations/${id}/boundary`)

  const [step, setStep] = useState(1)
  const [approach, setApproach] = useState<Approach | undefined>()
  const [baseYear, setBaseYear] = useState('')
  const fyStart = data?.org.fiscalYearStartMonth ?? 1 // from Tenant Settings → Fiscal year starts in
  const [effectiveFrom, setEffectiveFrom] = useState('')
  const [facilities, setFacilities] = useState<FacilityRow[]>([])
  const [saving, setSaving] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [showHistory, setShowHistory] = useState(false)
  const [seededFrom, setSeededFrom] = useState<BoundaryData | null>(null)
  const history = useLoad<BoundaryState[]>(`/api/platform/organizations/${id}/boundary/history`)
  const dialog = useDialog()

  // Re-seed whenever the server data is (re)loaded. An approved version shows its frozen values.
  if (data && data !== seededFrom) {
    setSeededFrom(data)
    const frozen = data.boundary?.status === 'APPROVED' && data.boundary.snapshot
    setFacilities(frozen ? data.boundary!.snapshot!.map(s => ({ ...s, isActive: true })) : data.facilities)
    setStep(data.boundary?.status === 'APPROVED' ? 3 : seededFrom ? step : 1)
    if (data.boundary) {
      setApproach(data.boundary.approach)
      setBaseYear(String(data.boundary.baseYear ?? data.org.baseYear ?? ''))
      setEffectiveFrom(data.boundary.effectiveFrom ? data.boundary.effectiveFrom.slice(0, 10) : '')
    } else if (data.org.baseYear) {
      setBaseYear(String(data.org.baseYear))
    }
  }

  if (!data) return error ? <p className="status status--error" role="alert">{error}</p> : <Skeleton rows={5} />

  const locked = data.boundary?.status === 'APPROVED'
  const frozenIds = new Set(data.boundary?.snapshot?.map(s => s.id) ?? [])
  const addedSince = locked && data.boundary?.snapshot ? data.facilities.filter(f => f.isActive && !frozenIds.has(f.id)) : []

  const canGo = (n: number) => {
    if (n === 1) return true
    if (n === 2) return !!approach
    if (n === 3) return !!approach && facilities.length > 0
    return false
  }

  const patchFacility = (fId: string, patch: Partial<FacilityRow>) =>
    setFacilities(fs => fs.map(f => f.id === fId ? { ...f, ...patch } : f))

  const addFacility = async (v: Record<string, unknown>) => {
    const f = await apiPost<FacilityRow>(`/api/platform/organizations/${id}/facilities`, v)
    setFacilities(fs => [...fs, f].sort((a, b) => a.name.localeCompare(b.name)))
    setNotice(`Facility "${f.name}" added. Set its boundary fields below.`)
  }

  const saveToServer = async () => {
    const year = Number(baseYear)
    if (!approach) throw new Error('Choose a consolidation approach first (step 1).')
    if (!Number.isInteger(year) || year < 2000 || year > 2100) throw new Error('Enter a base year between 2000 and 2100.')
    if (!effectiveFrom) throw new Error('Enter the date the boundary is effective from.')
    setSaving(true); setErr(null)
    try {
      await apiPut(`/api/platform/organizations/${id}/boundary`, {
        approach, baseYear: Number(baseYear), effectiveFrom,
        facilities: facilities.map(f => ({
          facilityId: f.id,
          gridLocation: f.gridLocation,
          equityShare: f.equityShare,
          operationalControl: f.operationalControl,
          financialControl: f.financialControl,
          scope1Active: f.scope1Active,
          scope2Active: f.scope2Active,
        })),
      })
    } finally {
      setSaving(false)
    }
  }

  const handleSaveAndApprove = async () => {
    setSaving(true); setErr(null)
    try {
      await saveToServer()
      await apiPost(`/api/platform/organizations/${id}/boundary/approve`, {})
      setNotice('Boundary approved and locked.')
      reload(); history.reload()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  const handleNewVersion = async () => {
    const reason = await dialog.prompt({
      title: `Create version ${(data.boundary?.version ?? 0) + 1}?`,
      message: `Version ${data.boundary?.version} stays approved and unchanged in the history. The new version starts as an editable copy.`,
      input: { label: 'Reason for the change', required: true, placeholder: 'e.g. Acquired two new facilities' },
      confirmLabel: 'Create version',
    })
    if (reason === null) return
    setSaving(true); setErr(null)
    try {
      await apiPost(`/api/platform/organizations/${id}/boundary/new-version`, { changeReason: reason })
      setNotice(`Version ${(data.boundary?.version ?? 0) + 1} created as a draft. Make your changes, then approve it in step 3.`)
      reload(); history.reload()
      setStep(1)
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <>
      <header className="page__header page__header--row">
        <h1 className="page__title">Boundary Setup — {data.org.name}</h1>
        <Link className="button button--ghost" to={`/platform/organizations/${id}`}>← Back to {data.org.name}</Link>
      </header>

      <VersionBar boundary={data.boundary} versionCount={history.data?.length ?? 0} saving={saving}
        showHistory={showHistory} onToggleHistory={() => setShowHistory(s => !s)} onNewVersion={() => void handleNewVersion()} />

      {showHistory && history.data && (
        <VersionHistory versions={history.data} draftFacilities={locked ? null : facilities}
          draftSettings={{ approach, baseYear: Number(baseYear) || undefined, effectiveFrom }} />
      )}

      {locked && addedSince.length > 0 && (
        <p className="status status--error" role="status">
          {addedSince.length} active facilit{addedSince.length === 1 ? 'y was' : 'ies were'} added after version {data.boundary!.version} was approved and {addedSince.length === 1 ? 'is' : 'are'} not in it: {addedSince.map(f => f.name).join(', ')}. Create a new version to include {addedSince.length === 1 ? 'it' : 'them'}.
        </p>
      )}

      {/* Base year + effective from — shown on all steps */}
      <div className="card boundary-dates">
        <div className="form__row">
          <label className="field field--xs">
            <span className="field__label">Base year{fyStart > 1 && ' (fiscal year starting)'}</span>
            <input className="input" type="number" min={2000} max={2100} step={1} disabled={locked}
              value={baseYear} onChange={e => setBaseYear(e.target.value)} placeholder="e.g. 2024" />
            {baseYear && !isNaN(Number(baseYear)) && <span className="field__hint">{fiscalYearLabel(Number(baseYear), fyStart)}</span>}
          </label>
          <label className="field field--sm">
            <span className="field__label">Boundary effective from</span>
            <input className="input" type="date" disabled={locked}
              value={effectiveFrom} onChange={e => setEffectiveFrom(e.target.value)} />
          </label>
          {!locked && (
            <button className="button button--ghost" disabled={saving} onClick={() => void saveToServer().then(() => setNotice('Draft saved.')).catch(e => setErr((e as Error).message))}>
              {saving ? 'Saving…' : 'Save draft'}
            </button>
          )}
        </div>
      </div>

      <Notify message={notice} />
      <Notify kind="error" message={err} />

      <StepNav step={step} canGo={canGo} setStep={setStep} />

      {step === 1 && <Step1Approach approach={approach} setApproach={setApproach} locked={locked} onNext={() => setStep(2)} />}
      {step === 2 && <Step2Facilities facilities={facilities} approach={approach} locked={locked} onFacilityChange={patchFacility} onAddFacility={addFacility} onBack={() => setStep(1)} onNext={() => setStep(3)} />}
      {step === 3 && (
        <Step3Review org={data.org} boundary={data.boundary} facilities={facilities} approach={approach}
          baseYear={baseYear} effectiveFrom={effectiveFrom} locked={locked} saving={saving}
          onBack={() => setStep(2)} onSaveAndApprove={() => void handleSaveAndApprove()} />
      )}
    </>
  )
}
