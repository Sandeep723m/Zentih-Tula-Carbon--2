import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { Header, States } from '../components/Page'
import { useLoad } from '../hooks/useLoad'
import { API_URL } from '../services/apiClient'
import { day, humanize, methodName, orgT, plain, recordT, siteT, factorLabel } from '../services/format'
import { PeriodHealth } from '../components/PeriodHealth'
import { Tabs } from '../components/Tabs'
import type { Attention, Facility, Line, Report, ReportingPeriod, TotalKey } from '../types/api'

const APPROACH = { EQUITY: 'equity share', OPERATIONAL: 'operational control', FINANCIAL: 'financial control' }

// Emissions report for one period: preview on screen, CSV export, and the browser's print dialog for PDF.
// Figures come unrounded from the API and are rounded once here (workbook tab 08).
export default function ReportsPage() {
  const { me } = useAuth()
  const [params, setParams] = useSearchParams()
  const periodId = params.get('period') ?? ''
  const facilityId = params.get('facility') ?? ''
  const scope = params.get('scope') ?? 'all'
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); if (v) n.set(k, v); else n.delete(k); setParams(n) }
  // Activity date range: last 7 days, last 30 days, or custom from/to.
  const range = params.get('range') ?? ''
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  const daysAgo = (n: number) => iso(new Date(Date.now() - n * 86_400_000))
  const from = range === '7' ? daysAgo(7) : range === '30' ? daysAgo(30) : range === 'custom' ? params.get('from') ?? '' : ''
  const to = range === '7' || range === '30' ? iso(new Date()) : range === 'custom' ? params.get('to') ?? '' : ''
  const setRange = (v: string) => { const n = new URLSearchParams(params); n.delete('from'); n.delete('to'); if (v) n.set('range', v); else n.delete('range'); setParams(n) }

  const periods = useLoad<ReportingPeriod[]>('/api/reporting-periods')
  const facilities = useLoad<Facility[]>('/api/facilities')
  const query = `reportingPeriodId=${periodId}&scope=${scope}${facilityId ? `&facilityId=${facilityId}` : ''}${from ? `&from=${from}` : ''}${to ? `&to=${to}` : ''}`
  const report = useLoad<Report>(periodId ? `/api/reports/emissions?${query}` : '')
  const r = report.data
  const view = params.get('view') ?? 'summary'
  const attention = useLoad<Attention>(me?.permissions.includes('period.lock') ? '/api/attention' : '')
  const health = attention.data?.periods.find((a) => a.period.id === periodId)

  return (
    <>
      <div className="no-print stack stack--lg">
        <Header title="Reports" subtitle="Your emissions for a reporting period, ready to download or print." />
        <section className="card card--spaced">
          <div className="filters filters--bottom">
            <select className="input" aria-label="Reporting period" value={periodId} onChange={(e) => set('period', e.target.value)}>
              <option value="">Select a reporting period…</option>
              {periods.data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === 'LOCKED' ? ' (final)' : ' (provisional)'}</option>)}
            </select>
            <select className="input" aria-label="Facility" value={facilityId} onChange={(e) => set('facility', e.target.value)}>
              <option value="">All facilities</option>
              {facilities.data?.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}
            </select>
            <select className="input" aria-label="Scope" value={scope} onChange={(e) => set('scope', e.target.value === 'all' ? '' : e.target.value)}>
              <option value="all">Scope 1 and 2</option>
              <option value="1">Scope 1 only</option>
              <option value="2">Scope 2 only</option>
            </select>
            <select className="input" aria-label="Activity dates" value={range} onChange={(e) => setRange(e.target.value)}>
              <option value="">All dates</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
              <option value="custom">Custom dates</option>
            </select>
            {range === 'custom' && <>
              <input className="input" type="date" aria-label="From" value={params.get('from') ?? ''} max={params.get('to') ?? undefined} onChange={(e) => set('from', e.target.value)} />
              <input className="input" type="date" aria-label="To" value={params.get('to') ?? ''} min={params.get('from') ?? undefined} onChange={(e) => set('to', e.target.value)} />
            </>}
            {r && <a className="button button--ghost" href={`${API_URL}/api/reports/emissions?${query}&format=csv`}>Download CSV</a>}
            {r && <button className="button button--ghost" onClick={() => window.print()}>Print / save as PDF</button>}
          </div>
          {periods.data?.length === 0 && <p className="status">No reporting periods yet.</p>}
        </section>
      </div>

      {health && <div className="no-print"><PeriodHealth a={health} compact /></div>}
      {periodId && <States error={report.error} loading={!r} />}
      {r && (
        <article className="card report">
          <h2 className="card__title">{r.organization.legalName ?? r.organization.name} · Emissions report {r.period.name}</h2>
          <p>
            <span className={`badge ${r.status === 'FINAL' ? 'badge--approved' : 'badge--returned'}`}>{r.status === 'FINAL' ? `Final, locked ${day(r.period.lockedAt)}` : 'Provisional, figures may still change'}</span>
          </p>
          <dl className="facts">
            <div><dt>Period</dt><dd>{day(r.period.startDate)} – {day(r.period.endDate)}</dd></div>
            <div><dt>Calculated</dt><dd>{day(r.run.createdAt)} by {r.run.runBy}</dd></div>
            <div><dt>Method</dt><dd>{methodName(r.run.engineVersion)}, GWP {r.gwpSet}</dd></div>
            <div><dt>Boundary</dt><dd>{r.boundary ? `Version ${r.boundary.version}, ${APPROACH[r.boundary.approach]}` : 'Not yet approved'}</dd></div>
            {(r.filter.from || r.filter.to) && <div><dt>Activity dates</dt><dd>{r.filter.from ? day(r.filter.from) : 'Period start'} – {r.filter.to ? day(r.filter.to) : 'period end'}</dd></div>}
          </dl>

          <Tabs label="Report sections" active={view} onChange={(k) => set('view', k === 'summary' ? '' : k)} tabs={[
            { key: 'summary', label: 'Totals & facilities' },
            ...(Object.keys(r.gases).length ? [{ key: 'gases', label: 'By gas' }] : []),
            { key: 'method', label: 'Methodology & factors', count: r.factors.length },
            { key: 'warnings', label: 'Warnings & exclusions', count: r.warnings.length + r.blocked.length, alert: r.warnings.some((w) => !w.confirmedBy) || r.blocked.length > 0 },
            { key: 'records', label: 'Records', count: r.records.length },
          ]} />
          <div data-tabpanel hidden={view !== 'summary'}>
          <h3>Totals (tCO2e)</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Line</th><th className="num">Gross</th><th className="num">Counted under boundary</th></tr></thead>
              <tbody>
                {(Object.keys(r.totals) as TotalKey[]).map((k) => (
                  <tr key={k}><td>{r.lineLabels[k]}</td><td className="num">{orgT(r.totals[k]!.gross)}</td><td className="num">{orgT(r.totals[k]!.counted)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="field__hint">Scope 2 is shown two ways, location-based and market-based, and the two are never added together. Biogenic CO₂ and removals are shown separately and are not part of the totals.</p>

          {r.facilities.length > 0 && (
            <>
              <h3>By facility (tCO2e)</h3>
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Facility</th><th>Line</th><th className="num">Gross</th><th className="num">Share counted</th><th className="num">Counted</th></tr></thead>
                  <tbody>
                    {r.facilities.flatMap((f) => (Object.keys(f.totals) as TotalKey[]).map((k) => {
                      const share = k === 'BIOGENIC_MEMO' ? f.shares.SCOPE1 : f.shares[k as Line]
                      return (
                      <tr key={f.facility.id + k}>
                        <td>{f.facility.name}</td><td>{r.lineLabels[k]}</td><td className="num">{siteT(f.totals[k]!.gross)}</td>
                        <td className="num">{share ?? '—'}{share != null && '%'}</td>
                        <td className="num">{siteT(f.totals[k]!.counted)}</td>
                      </tr>
                      )
                    }))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          </div>
          <div data-tabpanel hidden={view !== 'gases'}>
          {Object.keys(r.gases).length > 0 && (
            <>
              <h3>Scope 1 by gas (kg)</h3>
              <p>{Object.entries(r.gases).map(([g, kg]) => `${g}: ${Number(kg).toLocaleString(undefined, { maximumFractionDigits: 3 })}`).join(' · ')}</p>
            </>
          )}

          </div>
          <div data-tabpanel hidden={view !== 'method'}>
          <h3>Methodology</h3>
          <ul className="plain">{r.methodology.map((m) => <li key={m.formulaCode}><strong>{m.formulaCode}</strong> {m.title}</li>)}</ul>

          <h3>Emission factors and GWPs used</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>ID</th><th>Activity · gas</th><th>Value</th><th>Source</th><th>Library</th><th>Valid</th></tr></thead>
              <tbody>
                {r.factors.map((f) => (
                  <tr key={f.code}>
                    <td>{f.code}</td><td>{f.activityCode ?? 'all'} · {f.gas}</td><td>{plain(f.value)} {f.numeratorUnit}/{f.denominatorUnit}</td>
                    <td>{f.source}<div className="field__hint">{f.sourceVersion}</div></td><td>{factorLabel(f)}</td><td>{day(f.validFrom)} to {f.validTo ? day(f.validTo) : 'open-ended'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          </div>
          <div data-tabpanel hidden={view !== 'warnings'}>
          {!r.warnings.length && !r.blocked.length && !r.run.notCalculableCount && <p className="field__hint">No warnings, blocked results or exclusions.</p>}
          {(r.warnings.length > 0 || r.blocked.length > 0 || r.run.notCalculableCount > 0) && (
            <>
              <h3>Warnings, confirmations and exclusions</h3>
              {r.blocked.length > 0 && <p className="status status--error">{r.blocked.length} result(s) were blocked and are not in the totals.</p>}
              {r.run.notCalculableCount > 0 && <p className="field__hint">{r.run.notCalculableCount} approved record(s) have no calculation method yet and are not in the totals.</p>}
              <ul className="plain plain--stack">
                {[...r.blocked, ...r.warnings].map((w) => (
                  <li key={w.resultId}>
                    <Link className="link no-print-link" to={`/activities/${w.recordId}`}>{w.facility} · {w.source}</Link> ({w.formulaCode}, {recordT(w.tCO2e)} tCO2e)
                    {w.issues.map((i) => <div key={i.code} className="field__hint">{humanize(i.message)}</div>)}
                    {w.confirmedBy ? <div className="field__hint">Confirmed by {w.confirmedBy} (“{w.confirmationReason}”)</div> : w.status === 'CALCULATED' && <div className="field__error">Not confirmed</div>}
                  </li>
                ))}
              </ul>
            </>
          )}

          </div>
          <div data-tabpanel hidden={view !== 'records'}>
          <h3>Records ({r.records.length})</h3>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Facility · source</th><th>Dates</th><th className="num">Quantity</th><th>Formula</th><th className="num">tCO2e</th></tr></thead>
              <tbody>
                {r.records.map((x) => (
                  <tr key={x.resultId}>
                    <td>{x.facility} · {x.source}<div className="field__hint">{x.activityCode}</div></td>
                    <td>{day(x.startDate)} to {day(x.endDate)}</td>
                    <td className="num">{plain(x.quantity)} {x.unit}</td>
                    <td>{x.formulaCode}{x.status === 'BLOCKED' && ' (blocked)'}</td>
                    <td className="num">{recordT(x.tCO2e)}{x.biogenicTCO2 && <div className="field__hint">+ {recordT(x.biogenicTCO2)} biogenic</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          </div>
          <p className="field__hint">
            Figures are rounded for display, so they may not add up exactly.
            {me?.permissions.includes('calc.read') && <> <Link className="link no-print-link" to={`/calculations?period=${r.period.id}&run=${r.run.id}`}>Open the calculation run</Link>.</>}
          </p>
        </article>
      )}
    </>
  )
}
