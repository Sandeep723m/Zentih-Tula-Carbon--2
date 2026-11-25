import { useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import { Header, Skeleton } from '../components/Page'
import { Pager, type Page } from '../components/Pager'
import { Tabs } from '../components/Tabs'
import { Notify } from '../components/Toast'
import { useLoad } from '../hooks/useLoad'
import { apiDelete, apiPost } from '../services/apiClient'
import { CATEGORY_LABELS, type Facility, type ReportingPeriod, type SourceCategory } from '../types/api'

type Severity = 'high' | 'medium' | 'low'
interface Finding {
  key: string; type: string; severity: Severity; title: string; detail: string; facilityName: string | null; category: SourceCategory | null; scope: 1 | 2 | null
  recordId?: string; documentId?: string; review?: { note: string; createdAt: string }
}
interface Tally { key: string; open: number; high: number }
interface Quality extends Page<Finding> {
  period: { id: string; name: string } | null
  counts: { records: number; complete: number; missingEvidence: number; pendingReview: number; returned: number; duplicates: number; anomalies: number; gaps: number; open: number; reviewed: number } | null
  byFacility: Tally[]; byCategory: Tally[]
}

const SEVERITY: Record<Severity, { label: string; badge: string }> = {
  high: { label: 'High', badge: 'badge--error' }, medium: { label: 'Medium', badge: 'badge--warning' }, low: { label: 'Low', badge: '' },
}
const TYPES: Record<string, string> = {
  MISSING_MONTH: 'Missing monthly bill', NO_RECORDS: 'No records', NO_SOURCES: 'Facility without sources', DUPLICATE_ENTRY: 'Duplicate entry', DUPLICATE_INVOICE: 'Duplicate invoice',
  MISSING_EVIDENCE: 'Missing evidence', INVALID_QUANTITY: 'Invalid quantity', MIXED_UNITS: 'Mixed units', BILL_MISMATCH: 'Differs from bill', ANOMALY: 'Unusual consumption',
}

// Problems in the activity data before calculation and period close. Findings point at records; they never change them.
export default function DataQualityPage() {
  const [params, setParams] = useSearchParams()
  const { me } = useAuth()
  const canReview = me?.permissions.includes('quality.manage') ?? false
  const canReconcile = me?.permissions.includes('reconcile.read') ?? false
  const navigate = useNavigate()
  const dialog = useDialog()
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const periods = useLoad<ReportingPeriod[]>('/api/reporting-periods').data ?? []
  const facilities = useLoad<Facility[]>('/api/facilities').data ?? []
  const query = new URLSearchParams([...params].filter(([, v]) => v)).toString()
  const { data, error: loadError, reload } = useLoad<Quality>(`/api/data-quality?${query}`)
  const state = params.get('state') ?? 'open'

  const filter = (k: string, v: string) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    if (k !== 'page') next.delete('page')
    setParams(next)
  }
  const act = async (run: () => Promise<unknown>, done: string) => {
    setError(null); setNotice(null)
    try { await run(); setNotice(done); reload() } catch (e) { setError((e as Error).message) }
  }
  const review = async (f: Finding) => {
    const note = await dialog.prompt({ title: 'Mark as no change needed?', message: f.detail, input: { label: 'Why no change is needed', required: true }, confirmLabel: 'Mark reviewed' })
    if (note !== null) await act(() => apiPost('/api/data-quality/reviews', { findingKey: f.key, note }), 'Finding marked as reviewed.')
  }
  // Starts a comparison of everything that describes this record's activity.
  const reconcile = async (f: Finding) => {
    setError(null)
    try { const r = await apiPost<{ id: string }>(`/api/reconciliations/from-record/${f.recordId}`); navigate(`/reconciliation?id=${r.id}`) } catch (e) { setError((e as Error).message) }
  }
  const reopen = (f: Finding) => act(() => apiDelete(`/api/data-quality/reviews?key=${encodeURIComponent(f.key)}`), 'Finding reopened.')
  const c = data?.counts

  return (
    <>
      <Header title="Data Quality" subtitle="Gaps, duplicates and unusual values to check in your data." />
      <Notify message={notice} />
      <Notify kind="error" message={error ?? loadError} />

      <div className="filters">
        <select className="input" aria-label="Reporting period" value={params.get('reportingPeriodId') ?? data?.period?.id ?? ''} onChange={(e) => filter('reportingPeriodId', e.target.value)}>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <select className="input" aria-label="Facility" value={params.get('facilityId') ?? ''} onChange={(e) => filter('facilityId', e.target.value)}>
          <option value="">All facilities</option>
          {facilities.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
        </select>
        <select className="input" aria-label="Scope" value={params.get('scope') ?? ''} onChange={(e) => filter('scope', e.target.value)}>
          <option value="">All scopes</option><option value="1">Scope 1</option><option value="2">Scope 2</option>
        </select>
        <select className="input" aria-label="Category" value={params.get('category') ?? ''} onChange={(e) => filter('category', e.target.value)}>
          <option value="">All categories</option>
          {(Object.keys(CATEGORY_LABELS) as SourceCategory[]).map((k) => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}
        </select>
        <select className="input" aria-label="Severity" value={params.get('severity') ?? ''} onChange={(e) => filter('severity', e.target.value)}>
          <option value="">All severities</option><option value="high">High</option><option value="medium">Medium</option><option value="low">Low</option>
        </select>
        <select className="input" aria-label="Finding type" value={params.get('type') ?? ''} onChange={(e) => filter('type', e.target.value)}>
          <option value="">All findings</option>
          {Object.entries(TYPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
        <select className="input" aria-label="Record status" value={params.get('recordStatus') ?? ''} onChange={(e) => filter('recordStatus', e.target.value)}>
          <option value="">Any record status</option><option value="DRAFT">Draft</option><option value="SUBMITTED">Submitted</option><option value="RETURNED">Returned</option><option value="APPROVED">Approved</option>
        </select>
      </div>

      {!data && !loadError && <Skeleton />}
      {loadError && <section className="card empty-state"><p>The data quality check could not load: {loadError}</p></section>}
      {data && !data.period && <section className="card empty-state"><p>Create a reporting period to check its data.</p></section>}
      {c && (
        <>
          <div className="stats">
            <div className="stat"><span className="stat__value">{c.records}</span><span className="stat__label">Activity records</span></div>
            <div className="stat"><span className="stat__value">{c.complete}</span><span className="stat__label">Complete (quantity and evidence)</span></div>
            <div className="stat"><span className="stat__value">{c.records - c.complete}</span><span className="stat__label">Incomplete</span></div>
            <div className="stat"><span className="stat__value">{c.missingEvidence}</span><span className="stat__label">Missing evidence</span></div>
            <div className="stat"><span className="stat__value">{c.duplicates}</span><span className="stat__label">Possible duplicates</span></div>
            <div className="stat"><span className="stat__value">{c.anomalies}</span><span className="stat__label">Unusual months</span></div>
            <div className="stat"><span className="stat__value">{c.gaps}</span><span className="stat__label">Gaps in data</span></div>
            <div className="stat"><span className="stat__value">{c.pendingReview}</span><span className="stat__label">Pending review</span></div>
            <div className="stat"><span className="stat__value">{c.returned}</span><span className="stat__label">Returned for correction</span></div>
          </div>

          <div className="quality-split">
            <TallyCard title="Open findings by facility" rows={data.byFacility} label={(k) => k} />
            <TallyCard title="Open findings by category" rows={data.byCategory} label={(k) => CATEGORY_LABELS[k as SourceCategory] ?? k} />
          </div>

          <section className="card">
            <Tabs small label="Finding state" active={state} onChange={(k) => filter('state', k === 'open' ? '' : k)} tabs={[
              { key: 'open', label: 'Open', count: c.open, alert: c.open > 0 },
              { key: 'reviewed', label: 'Reviewed', count: c.reviewed },
              { key: 'all', label: 'All' },
            ]} />
            {data.total === 0 && <p className="status">{state === 'open' ? 'No open findings for these filters.' : 'Nothing here.'}</p>}
            {!!data.rows.length && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Severity</th><th>Finding</th><th>Facility</th><th>Category</th><th aria-label="Actions" /></tr></thead>
                  <tbody>
                    {data.rows.map((f) => (
                      <tr key={f.key}>
                        <td><span className={`badge ${SEVERITY[f.severity].badge}`}>{SEVERITY[f.severity].label}</span></td>
                        <td>
                          <strong>{f.title}</strong>
                          <div className="field__hint">{f.detail}</div>
                          {f.review && <div className="field__hint">Reviewed {new Date(f.review.createdAt).toLocaleDateString()}: {f.review.note}</div>}
                        </td>
                        <td className="nowrap">{f.facilityName?.replace(/^\S+ — /, '') ?? '—'}</td>
                        <td>{f.category ? CATEGORY_LABELS[f.category] : '—'}</td>
                        <td>
                          <div className="actions actions--end">
                            {f.recordId && <Link className="button button--ghost button--small" to={`/activities/${f.recordId}`}>Open record</Link>}
                            {canReconcile && f.recordId && ['BILL_MISMATCH', 'DUPLICATE_ENTRY', 'ANOMALY'].includes(f.type) && <button type="button" className="button button--ghost button--small" onClick={() => void reconcile(f)}>Reconcile</button>}
                            {f.documentId && <Link className="button button--ghost button--small" to={`/documents?id=${f.documentId}`}>Open document</Link>}
                            {canReview && (f.review
                              ? <button type="button" className="button button--ghost button--small" onClick={() => void reopen(f)}>Reopen</button>
                              : <button type="button" className="button button--ghost button--small" onClick={() => void review(f)}>No change needed</button>)}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <Pager data={data} onPage={(p) => filter('page', String(p))} />
          </section>
        </>
      )}
    </>
  )
}

function TallyCard({ title, rows, label }: { title: string; rows: Tally[]; label: (key: string) => string }) {
  return (
    <section className="card">
      <h2 className="card__title">{title}</h2>
      {!rows.length ? <p className="status">No open findings.</p> : (
        <ul className="list">
          {rows.map((r) => (
            <li key={r.key} className="list__item">
              <span>{label(r.key)}</span>
              <span className="badges">{r.high > 0 && <span className="badge badge--error">{r.high} high</span>}<span className="badge">{r.open} open</span></span>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
