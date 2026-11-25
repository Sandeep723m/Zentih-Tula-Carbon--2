import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Trash2 } from 'lucide-react'
import { useDialog } from '../components/Dialog'
import { Header, States } from '../components/Page'
import { Tabs } from '../components/Tabs'
import { Notify } from '../components/Toast'
import { useLoad } from '../hooks/useLoad'
import { apiDelete, apiPost, apiPut } from '../services/apiClient'
import { CATEGORY_LABELS, type Facility, type ReportingPeriod, type SourceCategory } from '../types/api'

interface Totals { scope1: number; scope2Location: number; scope2Market: number; headline: number; byFacility: Array<{ key: string; tCO2e: number }>; byCategory: Array<{ key: string; tCO2e: number }> }
interface Rec { key: string; issue: string; data: string; suggestion: string; estimatedReductionTCO2e: number; assumptions: string; limitations: string }
interface Intensity { id: string; facility: string | null; metric: string; label: string; value: string; unit: string; scope1: number | null; scope2: number | null; total: number | null }
interface Overview { period: { id: string; name: string }; run: { id: string; createdAt: string } | null; totals: Totals; recommendations: Rec[]; intensities: Intensity[] }
interface Adjustment { target: 'category' | 'facility' | 'source'; key: string; percent: number | string } // a string while being typed ("-", "")
interface Projection { before: Totals; after: Totals; reduction: number; reductionPercent: number | null; byScope: Array<{ label: string; before: number; after: number; change: number }>; byFacility: Array<{ key: string; before: number; after: number }>; byCategory: Array<{ key: string; before: number; after: number }> }
interface Scenario { id: string; name: string; reportingPeriodId: string; adjustments: Adjustment[]; before: number; after: number; reduction: number; reductionPercent: number | null; createdAt: string }
interface Target {
  id: string; name: string; baselinePeriod: string | null; baselineTCO2e: string; goal: number; scope: string; targetYear: number; reductionPercent: string
  progress: Array<{ periodId: string; period: string; actual: number | null; path: number; onTrack: boolean | null }>
  revisions: Array<{ id: string; previousTCO2e: string | null; newTCO2e: string; reason: string; createdAt: string }>
}

const t = (n: number | null | undefined) => (n === null || n === undefined ? '—' : (Math.abs(n) < 0.005 ? 0 : n).toLocaleString(undefined, { maximumFractionDigits: 2 }))
const METRICS: Record<string, string> = { EMPLOYEES: 'Employees', PRODUCTION: 'Production', REVENUE: 'Revenue', AREA: 'Floor area', OUTPUT: 'Units of output' }
const SCOPES: Record<string, string> = { ALL: 'Scope 1 and 2 (location-based)', SCOPE1: 'Scope 1', SCOPE2: 'Scope 2 (location-based)' }
const label = (k: string) => CATEGORY_LABELS[k as SourceCategory] ?? k

// Where emissions can come down, what a change would do, and progress against targets. Projections are hypothetical
// and never change official records, runs or reports.
export default function CarbonIntelligencePage() {
  const [params, setParams] = useSearchParams()
  const periods = useLoad<ReportingPeriod[]>('/api/reporting-periods').data ?? []
  const periodId = params.get('period') ?? periods.at(-1)?.id ?? ''
  const tab = params.get('tab') ?? 'ideas'
  const set = (k: string, v: string) => { const n = new URLSearchParams(params); n.set(k, v); setParams(n) }
  return (
    <>
      <Header title="Carbon Intelligence" subtitle="Reduction ideas, scenarios and targets based on your emissions." />
      <div className="filters">
        <select className="input" aria-label="Reporting period" value={periodId} onChange={(e) => set('period', e.target.value)}>
          {periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
      </div>
      <Tabs label="Carbon intelligence" active={tab} onChange={(k) => set('tab', k)} tabs={[
        { key: 'ideas', label: 'Recommendations and intensity' }, { key: 'simulate', label: 'What-if simulator' }, { key: 'targets', label: 'Targets' },
      ]} />
      {periodId && tab === 'ideas' && <Ideas periodId={periodId} />}
      {periodId && tab === 'simulate' && <Simulator key={periodId} periodId={periodId} />}
      {tab === 'targets' && <Targets periods={periods} />}
    </>
  )
}

function Ideas({ periodId }: { periodId: string }) {
  const { data, error, reload } = useLoad<Overview>(`/api/insights/overview?reportingPeriodId=${periodId}`)
  const facilities = useLoad<Facility[]>('/api/facilities').data ?? []
  const dialog = useDialog()
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [form, setForm] = useState({ facilityId: '', metric: 'PRODUCTION', label: '', value: '', unit: '' })
  if (!data) return <States error={error} loading />
  if (!data.run) return <section className="card empty-state"><p>Calculate {data.period.name} first. Recommendations and intensity use its calculated results.</p></section>
  const save = async () => {
    try { await apiPut('/api/insights/intensity', { ...form, facilityId: form.facilityId || null, reportingPeriodId: periodId }); setMsg({ ok: 'Measure saved.' }); setForm({ ...form, label: '', value: '', unit: '' }); reload() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const remove = async (m: Intensity) => {
    if (!(await dialog.confirm({ title: 'Delete this measure?', confirmLabel: 'Delete', danger: true }))) return
    try { await apiDelete(`/api/insights/intensity/${m.id}`); reload() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <>
      <Notify message={msg.ok} /><Notify kind="error" message={msg.err} />
      <div className="stats">
        <div className="stat"><span className="stat__value">{t(data.totals.headline)}</span><span className="stat__label">tCO2e, Scope 1 and 2 (location-based)</span></div>
        <div className="stat"><span className="stat__value">{t(data.totals.scope1)}</span><span className="stat__label">tCO2e, Scope 1</span></div>
        <div className="stat"><span className="stat__value">{t(data.totals.scope2Location)}</span><span className="stat__label">tCO2e, Scope 2 location-based</span></div>
        <div className="stat"><span className="stat__value">{t(data.totals.scope2Market)}</span><span className="stat__label">tCO2e, Scope 2 market-based</span></div>
      </div>
      <section className="card">
        <h2 className="card__title">Reduction opportunities</h2>
        <p className="field__hint">Based on {data.period.name}'s calculated results. Estimates show what a stated change could achieve; they are not guaranteed reductions.</p>
        {!data.recommendations.length ? <p className="status">No recommendations for this period's data.</p> : (
          <ul className="list">
            {data.recommendations.map((r) => (
              <li key={r.key} className="insight">
                <div className="insight__head"><strong>{r.issue}</strong><span className="badge badge--soft">Up to {t(r.estimatedReductionTCO2e)} tCO2e</span></div>
                <p className="field__hint">{r.data}</p>
                <p>{r.suggestion}</p>
                <p className="field__hint"><strong>Assumption:</strong> {r.assumptions} <strong>Limitations:</strong> {r.limitations}</p>
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="card">
        <h2 className="card__title">Carbon intensity</h2>
        <p className="field__hint">Emissions divided by a business measure you enter for this period. Compare facilities only when they define production and boundaries the same way.</p>
        {!!data.intensities.length && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Applies to</th><th>Per</th><th className="num">Scope 1</th><th className="num">Scope 2</th><th className="num">Scope 1 and 2</th><th /></tr></thead>
              <tbody>{data.intensities.map((m) => (
                <tr key={m.id}>
                  <td>{m.facility ?? 'Whole organisation'}</td>
                  <td>{m.label}<div className="field__hint">{METRICS[m.metric]}: {Number(m.value).toLocaleString()} {m.unit} in {data.period.name}</div></td>
                  <td className="num">{t(m.scope1)}</td><td className="num">{t(m.scope2)}</td><td className="num"><strong>{t(m.total)}</strong> <span className="field__hint">tCO2e per {m.unit}</span></td>
                  <td><button type="button" className="button button--ghost button--small button--danger" aria-label="Delete measure" onClick={() => void remove(m)}><Trash2 size={14} /></button></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
        <div className="grid-cols">
          <label className="field"><span className="field__label">Applies to</span>
            <select className="input" value={form.facilityId} onChange={(e) => setForm({ ...form, facilityId: e.target.value })}><option value="">Whole organisation</option>{facilities.map((f) => <option key={f.id} value={f.id}>{f.code} — {f.name}</option>)}</select></label>
          <label className="field"><span className="field__label">Measure</span>
            <select className="input" value={form.metric} onChange={(e) => setForm({ ...form, metric: e.target.value })}>{Object.entries(METRICS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span className="field__label">Description</span><input className="input" placeholder="e.g. Tonnes of clinker" value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} /></label>
          <label className="field"><span className="field__label">Value</span><input className="input" inputMode="decimal" value={form.value} onChange={(e) => setForm({ ...form, value: e.target.value })} /></label>
          <label className="field"><span className="field__label">Unit</span><input className="input" placeholder="t, employees, m², INR crore" value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value })} /></label>
        </div>
        <div className="actions"><button type="button" className="button" disabled={!form.label || !form.value || !form.unit} onClick={() => void save()}>Save measure</button></div>
      </section>
    </>
  )
}

function Simulator({ periodId }: { periodId: string }) {
  const options = useLoad<{ run: object | null; categories: Array<{ key: string; label: string }>; facilities: Array<{ key: string; label: string }>; sources: Array<{ key: string; label: string }> }>(`/api/insights/simulation-options?reportingPeriodId=${periodId}`)
  const scenarios = useLoad<Scenario[]>('/api/insights/scenarios')
  const dialog = useDialog()
  const [adjustments, setAdjustments] = useState<Adjustment[]>([])
  const [result, setResult] = useState<Projection | null>(null)
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const o = options.data
  if (!o) return <States error={options.error} loading />
  if (!o.run) return <section className="card empty-state"><p>Calculate this period first. Scenarios start from its calculated results.</p></section>
  const choices = (target: Adjustment['target']) => (target === 'category' ? o.categories.map((c) => ({ key: c.key, label: label(c.key) })) : target === 'facility' ? o.facilities : o.sources)
  // Any edit clears the last projection, so what is on screen always matches the changes listed.
  const update = (i: number, patch: Partial<Adjustment>) => { setResult(null); setAdjustments(adjustments.map((a, n) => (n === i ? { ...a, ...patch, ...(patch.target ? { key: choices(patch.target)[0]?.key ?? '' } : {}) } : a))) }
  const clean = () => adjustments.map((a) => ({ ...a, percent: Number(a.percent) }))
  const invalid = adjustments.some((a) => a.percent === '' || !Number.isFinite(Number(a.percent)) || Number(a.percent) < -100 || Number(a.percent) > 500)
  const run = async () => {
    setMsg({})
    if (invalid) return setMsg({ err: 'Enter each change as a percentage between -100 and 500.' })
    try { setResult(await apiPost<Projection>('/api/insights/simulate', { reportingPeriodId: periodId, adjustments: clean() })) } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const save = async () => {
    const name = await dialog.prompt({ title: 'Save this scenario', input: { label: 'Name', required: true }, confirmLabel: 'Save' })
    if (name === null) return
    try { await apiPost('/api/insights/scenarios', { name, reportingPeriodId: periodId, adjustments: clean() }); setMsg({ ok: 'Scenario saved.' }); scenarios.reload() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  const remove = async (s: Scenario) => {
    if (!(await dialog.confirm({ title: `Delete "${s.name}"?`, confirmLabel: 'Delete', danger: true }))) return
    try { await apiDelete(`/api/insights/scenarios/${s.id}`); scenarios.reload() } catch (e) { setMsg({ err: (e as Error).message }) }
  }
  return (
    <>
      <Notify message={msg.ok} /><Notify kind="error" message={msg.err} />
      <section className="card">
        <h2 className="card__title">Build a scenario</h2>
        <p className="field__hint">Change activity by a percentage to see the effect on emissions.</p>
        {adjustments.map((a, i) => (
          <div key={i} className="filters">
            <select className="input" aria-label="Change applies to" value={a.target} onChange={(e) => update(i, { target: e.target.value as Adjustment['target'] })}>
              <option value="category">Category</option><option value="facility">Facility</option><option value="source">Emission source</option>
            </select>
            <select className="input" aria-label="Which" value={a.key} onChange={(e) => update(i, { key: e.target.value })}>{choices(a.target).map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}</select>
            <input className="input simulate__percent" type="number" min={-100} max={500} aria-label="Change in percent" value={a.percent} onChange={(e) => update(i, { percent: e.target.value })} /><span>%</span>
            <button type="button" className="button button--ghost button--small" onClick={() => { setResult(null); setAdjustments(adjustments.filter((_, n) => n !== i)) }}>Remove</button>
          </div>
        ))}
        <div className="actions">
          <button type="button" className="button button--ghost" onClick={() => { setResult(null); return setAdjustments([...adjustments, { target: 'category', key: (o.categories.find((c) => c.key !== 'REMOVAL') ?? o.categories[0])?.key ?? '', percent: -10 }]) }}>Add a change</button>
          <button type="button" className="button" disabled={!adjustments.length} onClick={() => void run()}>Project</button>
          {result && <button type="button" className="button button--ghost" onClick={() => void save()}>Save scenario</button>}
        </div>
      </section>
      {result && (
        <section className="card">
          <div className="card__headline"><h2 className="card__title">Projected result</h2><span className="badge badge--warning">Hypothetical</span></div>
          <div className="stats">
            <div className="stat"><span className="stat__value">{t(result.before.headline)}</span><span className="stat__label">Current, tCO2e</span></div>
            <div className="stat"><span className="stat__value">{t(result.after.headline)}</span><span className="stat__label">Projected, tCO2e</span></div>
            <div className="stat"><span className="stat__value">{t(result.reduction)}</span><span className="stat__label">Potential reduction, tCO2e</span></div>
            <div className="stat"><span className="stat__value">{result.reductionPercent === null ? '—' : `${t(-result.reductionPercent)}%`}</span><span className="stat__label">Reduction</span></div>
          </div>
          <div className="quality-split">
            <ImpactTable title="By scope" rows={result.byScope.map((s) => ({ key: s.label, before: s.before, after: s.after }))} />
            <ImpactTable title="By facility" rows={result.byFacility} />
            <ImpactTable title="By category" rows={result.byCategory.map((c) => ({ ...c, key: label(c.key) }))} />
          </div>
        </section>
      )}
      <section className="card">
        <h2 className="card__title">Saved scenarios</h2>
        <States error={scenarios.error} loading={!scenarios.data} empty={scenarios.data?.length === 0 && 'No saved scenarios yet.'} />
        {!!scenarios.data?.length && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Scenario</th><th className="num">Current</th><th className="num">Projected</th><th className="num">Reduction</th><th /></tr></thead>
              <tbody>{scenarios.data.map((s) => (
                <tr key={s.id}>
                  <td>{s.name}<div className="field__hint">{s.adjustments.length} change{s.adjustments.length === 1 ? '' : 's'} · saved {new Date(s.createdAt).toLocaleDateString()}</div></td>
                  <td className="num">{t(s.before)}</td><td className="num">{t(s.after)}</td>
                  <td className="num">{t(s.reduction)} tCO2e{s.reductionPercent !== null && ` (${t(-s.reductionPercent)}%)`}</td>
                  <td><div className="actions actions--end">
                    <button type="button" className="button button--ghost button--small" onClick={() => { setAdjustments(s.adjustments); setResult(null) }}>Load</button>
                    <button type="button" className="button button--ghost button--small button--danger" aria-label="Delete scenario" onClick={() => void remove(s)}><Trash2 size={14} /></button>
                  </div></td>
                </tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>
    </>
  )
}

function ImpactTable({ title, rows }: { title: string; rows: Array<{ key: string; before: number; after: number }> }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>{title}</th><th className="num">Current</th><th className="num">Projected</th></tr></thead>
        <tbody>{rows.map((r) => <tr key={r.key}><td>{r.key}</td><td className="num">{t(r.before)}</td><td className="num">{t(r.after)}</td></tr>)}</tbody>
      </table>
    </div>
  )
}

function Targets({ periods }: { periods: ReportingPeriod[] }) {
  const { data, error, reload } = useLoad<Target[]>('/api/insights/targets')
  const dialog = useDialog()
  const [msg, setMsg] = useState<{ ok?: string; err?: string }>({})
  const [form, setForm] = useState(() => ({ name: '', baselinePeriodId: '', scope: 'ALL', targetYear: String(new Date().getFullYear() + 5), reductionPercent: '30' }))
  const act = async (run: () => Promise<unknown>, ok: string) => { setMsg({}); try { await run(); setMsg({ ok }); reload() } catch (e) { setMsg({ err: (e as Error).message }) } }
  const create = () => act(() => apiPost('/api/insights/targets', { ...form, baselinePeriodId: form.baselinePeriodId || periods[0]?.id, targetYear: Number(form.targetYear), reductionPercent: Number(form.reductionPercent) }), 'Target created.')
  const rebaseline = async (x: Target) => {
    const reason = await dialog.prompt({ title: 'Recalculate the baseline?', message: 'The baseline is worked out again from the baseline period\'s current results. The previous figure stays in the history.', input: { label: 'Reason, e.g. acquisition or corrected data', required: true }, confirmLabel: 'Recalculate' })
    if (reason !== null) await act(() => apiPost(`/api/insights/targets/${x.id}/rebaseline`, { reason }), 'Baseline recalculated.')
  }
  const remove = async (x: Target) => { if (await dialog.confirm({ title: `Delete "${x.name}"?`, confirmLabel: 'Delete', danger: true })) await act(() => apiDelete(`/api/insights/targets/${x.id}`), 'Target deleted.') }
  return (
    <>
      <Notify message={msg.ok} /><Notify kind="error" message={msg.err} />
      <States error={error} loading={!data} />
      {data?.map((x) => (
        <section key={x.id} className="card">
          <div className="card__headline card__headline--top">
            <div className="stack stack--xs">
              <h2 className="card__title">{x.name}</h2>
              <p className="field__hint">{SCOPES[x.scope]} · baseline {x.baselinePeriod}: {t(Number(x.baselineTCO2e))} tCO2e · {Number(x.reductionPercent)}% lower by {x.targetYear} ({t(x.goal)} tCO2e)</p>
            </div>
            <div className="actions">
              <button type="button" className="button button--ghost button--small" onClick={() => void rebaseline(x)}>Recalculate baseline</button>
              <button type="button" className="button button--ghost button--small button--danger" aria-label="Delete target" onClick={() => void remove(x)}><Trash2 size={14} /></button>
            </div>
          </div>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Period</th><th className="num">Actual tCO2e</th><th className="num">Target path</th><th>Status</th></tr></thead>
              <tbody>{x.progress.map((p) => (
                <tr key={p.periodId}>
                  <td>{p.period}</td><td className="num">{t(p.actual)}</td><td className="num">{t(p.path)}</td>
                  <td>{p.onTrack === null ? <span className="badge">Not calculated</span> : p.onTrack ? <span className="badge badge--success">On track</span> : <span className="badge badge--error">Above path</span>}</td>
                </tr>
              ))}</tbody>
            </table>
          </div>
          <details className="doc-history">
            <summary className="field__label">Baseline history ({x.revisions.length})</summary>
            <ul className="list">{x.revisions.map((r) => <li key={r.id} className="list__item"><span>{r.previousTCO2e ? `${t(Number(r.previousTCO2e))} → ` : ''}{t(Number(r.newTCO2e))} tCO2e: {r.reason}</span><span className="list__meta">{new Date(r.createdAt).toLocaleDateString()}</span></li>)}</ul>
          </details>
        </section>
      ))}
      <section className="card">
        <h2 className="card__title">New target</h2>
        <div className="grid-cols">
          <label className="field"><span className="field__label">Name</span><input className="input" placeholder="e.g. 30% lower by 2030" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
          <label className="field"><span className="field__label">Baseline period</span><select className="input" value={form.baselinePeriodId} onChange={(e) => setForm({ ...form, baselinePeriodId: e.target.value })}>{periods.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select></label>
          <label className="field"><span className="field__label">Covers</span><select className="input" value={form.scope} onChange={(e) => setForm({ ...form, scope: e.target.value })}>{Object.entries(SCOPES).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
          <label className="field"><span className="field__label">Target year</span><input className="input" type="number" value={form.targetYear} onChange={(e) => setForm({ ...form, targetYear: e.target.value })} /></label>
          <label className="field"><span className="field__label">Reduction (%)</span><input className="input" type="number" value={form.reductionPercent} onChange={(e) => setForm({ ...form, reductionPercent: e.target.value })} /></label>
        </div>
        <p className="field__hint">The baseline comes from the baseline period's calculated results, so calculate that period first.</p>
        <div className="actions"><button type="button" className="button" disabled={!form.name} onClick={() => void create()}>Create target</button></div>
      </section>
    </>
  )
}
