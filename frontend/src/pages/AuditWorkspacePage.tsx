import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { Download } from 'lucide-react'
import { Header, States } from '../components/Page'
import { Notify } from '../components/Toast'
import { useLoad } from '../hooks/useLoad'
import { API_URL } from '../services/apiClient'
import { CATEGORY_LABELS, type Facility, type ReportingPeriod, type SourceCategory } from '../types/api'

interface Readiness { period: { id: string; name: string; status: string }; run: { id: string; createdAt: string } | null
  indicators: { submitted: number; withEvidence: number; withoutEvidence: number; approved: number; awaiting: number; openQueries: number; warnings: number; unconfirmed: number } }
interface Sample { population: number; rows: Array<{ id: string; startDate: string; endDate: string; quantity: string; unit: string; status: string; facility: { code: string }; emissionSource: { name: string; category: SourceCategory }; _count: { evidence: number }; tCO2e: number; warning: boolean }> }

// One place for an external auditor: what is ready, a sample of records to test, and the full evidence pack.
export default function AuditWorkspacePage() {
  const [params, setParams] = useSearchParams()
  const periods = useLoad<ReportingPeriod[]>('/api/reporting-periods').data ?? []
  const facilities = useLoad<Facility[]>('/api/facilities').data ?? []
  const periodId = params.get('period') ?? periods.at(-1)?.id ?? ''
  const ready = useLoad<Readiness>(periodId ? `/api/audit-workspace/readiness?reportingPeriodId=${periodId}` : '')
  const [filters, setFilters] = useState({ facilityId: '', category: '', risk: '', minQuantity: '', minTCO2e: '', size: '25' })
  const [query, setQuery] = useState('')
  const sample = useLoad<Sample>(query)
  const [notice, setNotice] = useState<string | null>(null)
  const draw = () => setQuery(`/api/audit-workspace/sample?${new URLSearchParams({ reportingPeriodId: periodId, ...Object.fromEntries(Object.entries(filters).filter(([, v]) => v)), n: String(Date.now()) })}`)
  const i = ready.data?.indicators
  return (
    <>
      <Header title="Audit Workspace" subtitle="Everything a verifier needs for a reporting period, in one place." />
      <Notify message={notice} />
      <div className="filters">
        <select className="input" aria-label="Reporting period" value={periodId} onChange={(e) => { setParams({ period: e.target.value }); setQuery('') }}>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        {periodId && <a className="button" href={`${API_URL}/api/audit-workspace/evidence-pack?reportingPeriodId=${periodId}`} onClick={() => setNotice('Preparing the evidence pack. The download starts when it is ready.')}><Download size={16} /> Download evidence pack</a>}
      </div>
      <States error={ready.error} loading={!!periodId && !ready.data} empty={!periods.length && 'No reporting periods are available to you.'} />
      {i && (
        <section className="card">
          <h2 className="card__title">Audit readiness</h2>
          <p className="field__hint">Each indicator stands on its own; together they are not a compliance score.{ready.data?.run ? ` Calculations from the run of ${new Date(ready.data.run.createdAt).toLocaleString()}.` : ' This period has not been calculated yet.'}</p>
          <div className="stats">
            <div className="stat"><span className="stat__value">{i.submitted}</span><span className="stat__label">Submitted records</span></div>
            <div className="stat"><span className="stat__value">{i.withEvidence}</span><span className="stat__label">With supporting evidence</span></div>
            <div className="stat"><span className="stat__value">{i.withoutEvidence}</span><span className="stat__label">Without evidence</span></div>
            <div className="stat"><span className="stat__value">{i.approved}</span><span className="stat__label">Approved</span></div>
            <div className="stat"><span className="stat__value">{i.awaiting}</span><span className="stat__label">Awaiting review</span></div>
            <div className="stat"><span className="stat__value">{i.openQueries}</span><span className="stat__label">With open queries</span></div>
            <div className="stat"><span className="stat__value">{i.warnings}</span><span className="stat__label">Calculation warnings ({i.unconfirmed} unconfirmed)</span></div>
          </div>
        </section>
      )}
      {periodId && (
        <section className="card">
          <h2 className="card__title">Sample records for testing</h2>
          <div className="filters">
            <select className="input" aria-label="Facility" value={filters.facilityId} onChange={(e) => setFilters({ ...filters, facilityId: e.target.value })}><option value="">All facilities</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}</select>
            <select className="input" aria-label="Category" value={filters.category} onChange={(e) => setFilters({ ...filters, category: e.target.value })}><option value="">All categories</option>{(Object.keys(CATEGORY_LABELS) as SourceCategory[]).map((k) => <option key={k} value={k}>{CATEGORY_LABELS[k]}</option>)}</select>
            <select className="input" aria-label="Selection" value={filters.risk} onChange={(e) => setFilters({ ...filters, risk: e.target.value })}>
              <option value="">Random sample</option><option value="largest">Largest emitters</option><option value="missingEvidence">Missing evidence</option><option value="openQuery">With open queries</option><option value="warning">With calculation warnings</option>
            </select>
            <input className="input" inputMode="decimal" placeholder="Minimum quantity" aria-label="Minimum quantity" value={filters.minQuantity} onChange={(e) => setFilters({ ...filters, minQuantity: e.target.value })} />
            <input className="input" inputMode="decimal" placeholder="Minimum tCO2e" aria-label="Minimum tCO2e" value={filters.minTCO2e} onChange={(e) => setFilters({ ...filters, minTCO2e: e.target.value })} />
            <input className="input" type="number" min={1} max={200} aria-label="Sample size" value={filters.size} onChange={(e) => setFilters({ ...filters, size: e.target.value })} />
            <button type="button" className="button" onClick={draw}>Draw sample</button>
          </div>
          {query && <States error={sample.error} loading={!sample.data} />}
          {sample.data && (
            <>
              <p className="field__hint">{sample.data.rows.length} of {sample.data.population} matching records.</p>
              {!!sample.data.rows.length && (
                <div className="table-wrap">
                  <table className="table">
                    <thead><tr><th>Record</th><th>Dates</th><th className="num">Quantity</th><th className="num">tCO2e</th><th>Evidence</th><th /></tr></thead>
                    <tbody>{sample.data.rows.map((r) => (
                      <tr key={r.id}>
                        <td>{r.facility.code} · {r.emissionSource.name}<div className="field__hint">{CATEGORY_LABELS[r.emissionSource.category]}{r.warning && ' · calculation warning'}</div></td>
                        <td className="nowrap">{r.startDate} to {r.endDate}</td>
                        <td className="num">{Number(r.quantity).toLocaleString()} {r.unit}</td>
                        <td className="num">{r.tCO2e ? r.tCO2e.toLocaleString(undefined, { maximumFractionDigits: 3 }) : '—'}</td>
                        <td>{r._count.evidence ? `${r._count.evidence} file${r._count.evidence > 1 ? 's' : ''}` : <span className="badge badge--warning">None</span>}</td>
                        <td><Link className="button button--ghost button--small" to={`/activities/${r.id}`}>Inspect</Link></td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </section>
      )}
    </>
  )
}
