import { useEffect, useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import { scrollToTarget } from '../components/smoothScroll'
import { apiPost } from '../services/apiClient'
import { day, humanize, orgT, plain, recordT, siteT, factorLabel, appliedValues } from '../services/format'
import { CATEGORY_LABELS, LINE_LABELS, STATUS_LABELS, type Attention, type PeriodPreview, type SourceCategory, type CalcResult, type CalcRun, type CalcRunDetail, type Line, type ReportingPeriod, type TotalKey } from '../types/api'
import { Header, States } from '../components/Page'
import { useLoad } from '../hooks/useLoad'
import { PeriodHealth } from '../components/PeriodHealth'
import { Tabs } from '../components/Tabs'
import { CircleCheck, Factory, Flame, ListChecks, Play, Recycle, ShieldCheck, Snowflake, Thermometer, Zap, type LucideIcon } from 'lucide-react'
import { Notify } from '../components/Toast'

const APPROACH = { EQUITY: 'equity share', OPERATIONAL: 'operational control', FINANCIAL: 'financial control' }
const LINES: Line[] = ['SCOPE1', 'SCOPE2_LOCATION', 'SCOPE2_MARKET', 'SCOPE2_HEAT', 'REMOVALS']
// Runs made before Scope 1 and market-based existed only have the location-based total.
const totalOf = (r: CalcRun, k: TotalKey) => r.totals?.[k] ?? (k === 'SCOPE2_LOCATION' ? { gross: r.scope2LocationTCO2e, counted: r.scope2LocationBoundaryTCO2e } : null)

export default function CalculationsPage() {
  const { me } = useAuth()
  const canRun = me?.permissions.includes('calc.run') ?? false
  const [params, setParams] = useSearchParams()
  const periodId = params.get('period') ?? ''
  const filter = params.get('filter') ?? ''
  const page = Number(params.get('page') ?? '1')
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k)
    setParams(next)
  }

  const periods = useLoad<ReportingPeriod[]>('/api/reporting-periods')
  const attention = useLoad<Attention>(canRun ? '/api/attention' : '')
  const health = attention.data?.periods.find((a) => a.period.id === periodId)
  const runs = useLoad<CalcRun[]>(periodId ? `/api/calculations/runs?reportingPeriodId=${periodId}` : '')
  // The run on screen: the one chosen in the history, else the latest (so "See blocked" links always land on results).
  const runId = params.get('run') || runs.data?.[0]?.id || ''
  const detail = useLoad<CalcRunDetail>(runId ? `/api/calculations/runs/${runId}?page=${page}${filter ? `&${filter}` : ''}` : '')
  const [busy, setBusy] = useState(false)
  const [gwpSet, setGwpSet] = useState<'AR6' | 'AR5'>('AR6')
  const dialog = useDialog()
  const selected = periods.data?.find((p) => p.id === periodId)
  const locked = selected?.status === 'LOCKED'
  const [error, setError] = useState<string | null>(null)
  const [justRan, setJustRan] = useState<string | null>(null)
  // After a run, take the person to its results and say what happened.
  useEffect(() => {
    if (!justRan || detail.data?.run.id !== justRan) return
    const el = document.getElementById('run-results')
    if (el) scrollToTarget(el, true)
  }, [justRan, detail.data])

  const run = async () => {
    setBusy(true); setError(null)
    try {
      let gwpReason: string | undefined
      if (gwpSet === 'AR5') {
        const r = await dialog.prompt({ title: 'Report this period on AR5?', message: 'AR6 is the default. AR5 is used only when the reporting scheme requires it; the whole run uses AR5.', input: { label: 'Why AR5 (scheme or requirement)', required: true }, confirmLabel: 'Run on AR5' })
        if (r === null) return
        gwpReason = r
      }
      const created = await apiPost<CalcRun>('/api/calculations/runs', { reportingPeriodId: periodId, gwpSet, gwpReason })
      runs.reload(); attention.reload()
      setJustRan(created.id)
      set({ run: created.id, page: '', filter: '' })
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  // Where the person is in the five steps, from the period's health.
  const step = !periodId ? 1
    : !health ? (locked ? 5 : 2)
    : health.counts.approved === 0 || health.counts.submitted > 0 ? 2
    : !health.run || !health.current ? 3
    : health.counts.blocked > 0 || health.counts.unconfirmed > 0 ? 4 : 5

  return (
    <>
      <Header title="Calculations" badge={<span className="badge badge--success"><ShieldCheck size={12} /> GHG Protocol</span>} subtitle="Calculate emissions from your approved activity data." />

      <section className="card card--spaced">
        <div className="card__headline">
          <p className="card__eyebrow"><ListChecks size={16} /> Calculation workflow</p>
          <span className="badge badge--soft">Every run is kept and auditable</span>
        </div>
        <ol className="steps" aria-label="Calculation steps">
          {['Choose the year', 'Check what is ready', 'Run the calculation', 'Confirm warnings', 'Lock & report'].map((label, i) => (
            <li key={label} className={`step ${i + 1 < step ? 'step--done' : i + 1 === step ? 'step--current' : ''}`} aria-current={i + 1 === step ? 'step' : undefined}>
              <span className="step__n">Step {i + 1}</span>{label}
              {i + 1 < step && <CircleCheck className="step__check" size={16} />}
            </li>
          ))}
        </ol>
      </section>

      <section className="card card--spaced">
        <div className="card__headline">
          <h2 className="section__title">Calculation configuration</h2>
          {selected && <span className="badge badge--soft">{day(selected.startDate)} to {day(selected.endDate)}</span>}
        </div>
        <div className="grid-cols">
          <label className="field">
            <span className="field__label">Reporting period *</span>
            <select className="input" value={periodId} onChange={(e) => set({ period: e.target.value, run: '', page: '', filter: '', cat: '' })}>
              <option value="">Select…</option>
              {periods.data?.map((p) => <option key={p.id} value={p.id}>{p.name} ({day(p.startDate)} to {day(p.endDate)}){p.status === 'LOCKED' ? ' · locked' : ''}</option>)}
            </select>
          </label>
          {canRun && (
            <label className="field">
              <span className="field__label">GWP 100-year standard *</span>
              <select className="input" value={gwpSet} onChange={(e) => setGwpSet(e.target.value as 'AR6' | 'AR5')} disabled={!periodId}>
                <option value="AR6">IPCC AR6 (default)</option>
                <option value="AR5">IPCC AR5 (only if your scheme requires it)</option>
              </select>
            </label>
          )}
        </div>
        {locked && <p className="field__hint">This period is locked. Its final run is marked below.</p>}
        {periods.data?.length === 0 && <p className="status">No reporting periods yet. <Link className="link" to="/reporting-periods">Set one up</Link>.</p>}
        <Notify kind="error" message={error} />
        {canRun && periodId && (
          <div className="card__footer">
            <span className="field__hint">{health?.counts.approved === 0 ? 'No approved records in this period yet.' : 'Only approved records are calculated. Nothing is saved until you run.'}</span>
            <button className="button" disabled={busy || locked || health?.counts.approved === 0} onClick={() => void run()}>
              <Play size={15} /> {busy ? 'Calculating…' : `Run calculation for ${selected?.name ?? 'this year'}`}
            </button>
          </div>
        )}
      </section>

      {canRun && periodId && !locked && <WhatWillBeCalculated periodId={periodId} active={params.get('cat') ?? ''} onCategory={(c) => set({ cat: c })} reloadKey={runs.data?.length ?? 0} />}
      {health && !locked && health.open.some((i) => i.mandatory) && <PeriodHealth a={health} compact />}

      {periodId && (
        <section className="card card--spaced">
          <h2 className="section__title">3. Runs and their results</h2>
          <p className="section__hint">Every run is kept. Open the latest to confirm its warnings (step 4), then lock the period on Period Close (step 5).</p>
          <States error={runs.error} loading={!runs.data} />
          {runs.data?.length === 0 && <p className="status">No runs for this period yet.{canRun && ' Click "Run calculation".'}</p>}
          {!!runs.data?.length && (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Run</th><th>By</th><th>Calculated</th><th>Blocked</th>{LINES.map((l) => <th key={l}>{LINE_LABELS[l]} (tCO2e)</th>)}<th /></tr></thead>
                <tbody>
                  {runs.data.map((r) => (
                    <tr key={r.id} className={r.id === runId ? 'is-selected' : undefined}>
                      <td>{new Date(r.createdAt).toLocaleString()}{r.reportingPeriod.finalRunId === r.id && <> <span className="badge badge--approved">Final</span></>}</td>
                      <td>{r.runBy.name}</td>
                      <td>{r.calculatedCount} of {r.recordCount}</td>
                      <td>{r.blockedCount || '—'}</td>
                      {LINES.map((l) => <td key={l}>{orgT(totalOf(r, l)?.gross ?? null)}</td>)}
                      <td><button className="button button--ghost button--small" onClick={() => set({ run: r.id, page: '', filter: '' })}>{r.id === runId ? 'Viewing' : 'View'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {(runs.data?.length ?? 0) > 1 && <CompareRuns runs={runs.data!} />}
        </section>
      )}

      {runId && <RunDetail justRan={justRan} detail={detail.data} error={detail.error} reload={() => { detail.reload(); attention.reload() }} canRun={canRun} filter={filter} set={set} />}
    </>
  )
}

function RunDetail({ justRan, detail, error, reload, canRun, filter, set }: {
  justRan: string | null; detail: CalcRunDetail | null; error: string | null; reload: () => void; canRun: boolean; filter: string; set: (p: Record<string, string>) => void
}) {
  const dialog = useDialog()
  const [actionError, setActionError] = useState<string | null>(null)
  // Arriving with a filter (e.g. "See blocked" from a checklist): bring the results into view.
  const loaded = !!detail
  useEffect(() => { if (filter && loaded) document.getElementById('results')?.scrollIntoView({ behavior: 'smooth', block: 'start' }) }, [filter, loaded])
  if (!detail) return <States error={error} loading />
  const { run, sites, results } = detail
  const pages = Math.max(1, Math.ceil(results.total / results.pageSize))

  const confirm = async (r: CalcResult) => {
    const reason = await dialog.prompt({
      title: 'Confirm this result?',
      message: r.issues.filter((i) => i.severity === 'WARN').map((i) => i.message).join(' '),
      input: { label: 'Reason (kept with the result)', required: true, placeholder: 'e.g. No CEA regional value published; fallback disclosed in the report' },
      confirmLabel: 'Confirm result',
    })
    if (reason === null) return
    setActionError(null)
    try { await apiPost(`/api/calculations/results/${r.id}/confirm`, { reason }); reload() } catch (e) { setActionError((e as Error).message) }
  }

  const confirmAll = async () => {
    const reason = await dialog.prompt({
      title: `Confirm all ${detail.awaitingConfirmation} result(s)?`,
      message: 'Every result awaiting confirmation in this run gets this reason, recorded and audited against each one. Only do this after reviewing them.',
      input: { label: 'Reason (kept with every result)', required: true, placeholder: 'e.g. Reviewed: IPCC defaults accepted, no site data; fallbacks disclosed' },
      confirmLabel: 'Confirm all',
    })
    if (reason === null) return
    setActionError(null)
    try { await apiPost(`/api/calculations/runs/${run.id}/confirm`, { reason }); reload() } catch (e) { setActionError((e as Error).message) }
  }

  // Columns that have a figure in this run, in reporting order.
  const COLS = (['SCOPE1', 'SCOPE2_LOCATION', 'SCOPE2_MARKET', 'SCOPE2_HEAT', 'REMOVALS', 'BIOGENIC_MEMO'] as TotalKey[]).filter((k) => totalOf(run, k) && Number(totalOf(run, k)!.gross) !== 0)
  const cats = CATEGORY_ORDER.filter((c) => detail.categories[c])
  // One row per record: an electricity record's location and market results sit side by side.
  const grouped = results.rows.reduce<CalcResult[][]>((acc, r) => {
    const last = acc[acc.length - 1]
    if (last && last[0].activityRecordId === r.activityRecordId) last.push(r); else acc.push([r])
    return acc
  }, [])
  const locked = run.reportingPeriod.status === 'LOCKED'

  return (
    <>
      <Notify message={justRan === run.id && `Calculation complete: ${run.calculatedCount} of ${run.recordCount} records calculated${run.blockedCount ? `, ${run.blockedCount} blocked (see below)` : ''}.${detail.awaitingConfirmation ? ` ${detail.awaitingConfirmation} warning(s) need confirming.` : ''}`} />
      <section className="card card--spaced" id="run-results">
        <h2 className="section__title">Results of the run of {new Date(run.createdAt).toLocaleString()} · {run.reportingPeriod.name}</h2>
        <p className="section__hint">
          {run.calculatedCount} of {run.recordCount} records calculated{run.blockedCount ? `, ${run.blockedCount} blocked` : ''} · GWP {run.gwpSet}
          {run.boundary ? ` · counted = share under boundary v${run.boundary.version} (${APPROACH[run.boundary.approach]})` : ' · no approved boundary: gross only'}
        </p>

        <div className="table-wrap">
          <table className="table matrix">
            <thead>
              <tr><th>Category</th>{COLS.map((k) => <th key={k} className="num">{LINE_LABELS[k]}</th>)}<th>Status</th></tr>
            </thead>
            <tbody>
              {cats.map((c) => {
                const x = detail.categories[c]!
                return (
                  <tr key={c}>
                    <td><button className="link link--button" onClick={() => set({ filter: `category=${c}`, page: '' })}>{CATEGORY_LABELS[c]}</button></td>
                    {COLS.map((k) => <td key={k} className="num">{x.lines[k] ? siteT(x.lines[k].gross) : <span className="field__hint">—</span>}</td>)}
                    <td>{x.blocked ? <span className="badge badge--returned">{x.blocked} blocked</span> : x.toConfirm ? <span className="badge badge--returned">{x.toConfirm} to confirm</span> : <span className="badge badge--success">✓ done</span>}</td>
                  </tr>
                )
              })}
              <tr className="matrix__total">
                <td><strong>Total (gross)</strong></td>
                {COLS.map((k) => <td key={k} className="num"><strong>{orgT(totalOf(run, k)?.gross ?? null)}</strong></td>)}
                <td />
              </tr>
              {run.boundary && (
                <tr className="matrix__total">
                  <td>Counted under boundary</td>
                  {COLS.map((k) => <td key={k} className="num">{orgT(totalOf(run, k)?.counted ?? null)}</td>)}
                  <td />
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="field__hint">Location-based and market-based Scope 2 are never added together. Biogenic CO₂ and removals are shown separately.</p>
        {run.notCalculableCount > 0 && <p className="field__hint">{run.notCalculableCount} approved record(s) have no calculation method and are not included.</p>}

        {detail.awaitingConfirmation > 0 && canRun && !locked ? (
          <div className="next next--problem">
            <p><strong>Step 4: {detail.awaitingConfirmation} result(s) need your confirmation</strong><br /><span className="field__hint">Each uses a default, a fallback or a judgement. Check them in "Needs confirmation" below, then confirm one by one or all at once with a reason.</span></p>
            <div className="actions">
              <button className="button button--ghost" onClick={() => set({ filter: 'attention=true', page: '' })}>Show them</button>
              <button className="button" onClick={() => void confirmAll()}>Confirm all…</button>
            </div>
          </div>
        ) : run.blockedCount === 0 && !locked && canRun && (
          <div className="next">
            <p><strong>Everything is calculated and confirmed.</strong><br /><span className="field__hint">Step 5: check the report, then lock the year.</span></p>
            <div className="actions">
              <Link className="button button--ghost" to={`/reports?period=${run.reportingPeriod.id}`}>Preview report</Link>
              <Link className="button" to={`/period-close?period=${run.reportingPeriod.id}`}>Lock on Period Close</Link>
            </div>
          </div>
        )}
        {run.blockedCount > 0 && <p className="status status--error">{run.blockedCount} record(s) are blocked: open them from the "Blocked" tab, fix the record, source or factor, and run again.</p>}
        <Notify kind="error" message={actionError} />
      </section>

      <section className="card card--spaced">
        <h2 className="section__title" id="results">Records and their results</h2>
        <div>
          <Tabs
            label="Results"
            active={filter}
            onChange={(k) => set({ filter: k, page: '' })}
            tabs={[
              { key: '', label: 'All', count: detail.tabCounts.ALL },
              ...cats.map((c) => ({ key: `category=${c}`, label: CATEGORY_SHORT[c], count: detail.categories[c]!.results })),
              { key: 'attention=true', label: 'Needs confirmation', count: detail.awaitingConfirmation, alert: true },
              ...(detail.tabCounts.BLOCKED ? [{ key: 'status=BLOCKED', label: 'Blocked', count: detail.tabCounts.BLOCKED, alert: true }] : []),
            ]}
          />
        </div>
        {results.total === 0 ? <p className="status">Nothing here.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Record</th><th className="num">Quantity</th><th>Result (tCO2e)</th><th>Factor used</th><th>Check</th></tr></thead>
              <tbody>
                {grouped.map((g) => {
                  const r0 = g[0]
                  return (
                    <tr key={r0.activityRecordId + r0.id}>
                      <td>
                        <Link className="link" to={`/activities/${r0.activityRecordId}`}>{r0.facility?.name} · {r0.activityRecord?.emissionSource.name}</Link>
                        <div className="field__hint">{day(r0.activityRecord?.startDate ?? null)} to {day(r0.activityRecord?.endDate ?? null)}</div>
                      </td>
                      <td className="num">
                        {plain(r0.inputs.quantity)} {r0.inputs.unitEntered}
                        {r0.inputs.convertedQuantity && r0.inputs.convertedTo !== r0.inputs.unit && <div className="field__hint">= {plain(r0.inputs.convertedQuantity)} {r0.inputs.convertedTo}</div>}
                      </td>
                      <td>
                        {g.map((r) => (
                          <div key={r.id}>
                            {r.status === 'BLOCKED' ? <span className="field__error">Blocked</span> : <strong>{recordT(r.tCO2e)}</strong>}
                            <span className="field__hint"> · {LINE_LABELS[r.line]}</span>
                            {r.biogenicTCO2 && <div className="field__hint">+ {recordT(r.biogenicTCO2)} t biogenic CO₂ (reported separately)</div>}
                          </div>
                        ))}
                      </td>
                      <td>{appliedValues(r0.inputs).ownCO2 ? <>Own CO₂ factor: {appliedValues(r0.inputs).ownCO2}{r0.emissionFactor && <div className="field__hint">Replaces library default {r0.emissionFactor.code} for CO₂</div>}</> : r0.emissionFactor ? <>{r0.emissionFactor.code}: {plain(r0.factorValue)} {r0.emissionFactor.numeratorUnit}/{r0.emissionFactor.denominatorUnit}<div className="field__hint">{r0.emissionFactor.source}{r0.emissionFactor.tier && ` · ${factorLabel({ organizationId: r0.emissionFactor.organizationId, tier: r0.emissionFactor.tier })}`}</div></> : <span className="field__hint">{r0.formulaCode === 'C-21' ? 'supplier factor' : r0.formulaCode === 'C-08' ? 'metered' : '—'}</span>}</td>
                      <td>{g.map((r) => <CheckCell key={r.id} r={r} canConfirm={canRun && !locked} onConfirm={() => void confirm(r)} />)}</td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        )}
        {pages > 1 && (
          <div className="cluster">
            <button className="button button--ghost button--small" disabled={results.page <= 1} onClick={() => set({ page: String(results.page - 1) })}>Previous</button>
            <span>Page {results.page} of {pages}</span>
            <button className="button button--ghost button--small" disabled={results.page >= pages} onClick={() => set({ page: String(results.page + 1) })}>Next</button>
          </div>
        )}
      </section>

      {sites.length > 0 && (
        <details className="card card--spaced">
          <summary className="section__title disclosure__summary">By facility ({sites.length})</summary>
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Facility</th>{LINES.map((l) => <th key={l} className="num">{LINE_LABELS[l]}</th>)}</tr></thead>
              <tbody>
                {sites.map((x) => (
                  <tr key={x.facility.id}>
                    <td>{x.facility.name}</td>
                    {LINES.map((l) => {
                      const v = x.lines[l]
                      return <td key={l} className="num">{v ? <>{siteT(v.tCO2e)}<div className="field__hint">{v.inclusionPct == null ? 'no share' : `${Number(v.inclusionPct)}% → ${siteT(v.countedTCO2e)}`}</div></> : '—'}</td>
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </>
  )
}

// A result's warnings as short codes; the full text and the confirm button on demand.
function CheckCell({ r, canConfirm, onConfirm }: { r: CalcResult; canConfirm: boolean; onConfirm: () => void }) {
  if (r.status === 'BLOCKED') return <div className="field__error" title={r.issues.map((i) => i.message).join('\n')}>{r.issues.map((i) => i.code).join(', ')}: {r.issues[0]?.message}</div>
  if (!r.issues.length) return <div><span className="badge badge--success">✓ OK</span></div>
  return (
    <details className="check-cell">
      <summary>
        {r.confirmedAt ? <span className="badge badge--success">✓ confirmed</span> : <span className="badge badge--returned">confirm</span>}{' '}
        <span className="field__hint">{r.issues.map((i) => i.code).join(', ')}</span>
      </summary>
      {r.issues.map((i) => <div key={i.code} className="field__hint">{humanize(i.message)}</div>)}
      {r.confirmedAt ? <div className="field__hint">Confirmed by {r.confirmedBy?.name ?? 'unknown user'} on {new Date(r.confirmedAt).toLocaleString()} (“{r.confirmationReason}”)</div>
        : canConfirm && r.needsConfirmation && <button className="button button--small" onClick={onConfirm}>Confirm…</button>}
    </details>
  )
}

const CATEGORY_ORDER: SourceCategory[] = ['FUEL_COMBUSTION', 'FUGITIVE_GAS', 'PROCESS', 'PURCHASED_ELECTRICITY', 'PURCHASED_ENERGY', 'REMOVAL']
const CATEGORY_SHORT: Record<SourceCategory, string> = {
  FUEL_COMBUSTION: 'Fuels', FUGITIVE_GAS: 'Refrigerants', PROCESS: 'Process', PURCHASED_ELECTRICITY: 'Electricity', PURCHASED_ENERGY: 'Steam / heat / cooling', REMOVAL: 'Removals',
}

const CATEGORY_ICON: Record<SourceCategory, LucideIcon> = {
  PURCHASED_ELECTRICITY: Zap, FUEL_COMBUSTION: Flame, FUGITIVE_GAS: Snowflake, PURCHASED_ENERGY: Thermometer, PROCESS: Factory, REMOVAL: Recycle,
}

const CATEGORY_HOW: Record<SourceCategory, string> = {
  PURCHASED_ELECTRICITY: 'MWh × grid factor, location-based and market-based',
  FUEL_COMBUSTION: 'Fuel → energy (NCV) × CO₂, CH₄ and N₂O factors → CO₂e',
  FUGITIVE_GAS: 'Gas leaked × its global warming potential',
  PURCHASED_ENERGY: 'GJ × the supplier\'s emission factor',
  PROCESS: 'Production × process factor, less any abated share',
  REMOVAL: 'Metered CO₂ captured, reported separately from emission totals',
}

// Step 2: what each category holds and what its approved records would give, before running.
function WhatWillBeCalculated({ periodId, active, onCategory, reloadKey }: { periodId: string; active: string; onCategory: (c: string) => void; reloadKey: number }) {
  const preview = useLoad<PeriodPreview>(`/api/calculations/preview?reportingPeriodId=${periodId}&r=${reloadKey}`)
  const p = preview.data
  if (!p) return <section className="card card--spaced"><States error={preview.error} loading /></section>
  if (!p.categories.length) return (
    <section className="card card--spaced">
      <h2 className="section__title">2. What will be calculated</h2>
      <p className="status">No activity records in {p.period.name} yet. <Link className="link" to="/activities/new">Enter data</Link> for this year first.</p>
    </section>
  )
  const cat = p.categories.find((c) => c.category === active) ?? p.categories[0]
  const waiting = cat.counts.DRAFT + cat.counts.SUBMITTED + cat.counts.RETURNED
  return (
    <section className="card card--spaced">
      <h2 className="section__title">2. What will be calculated</h2>
      <div className="tiles" role="group" aria-label="Categories">
        {p.categories.map((c) => {
          const Icon = CATEGORY_ICON[c.category]
          return (
            <button key={c.category} type="button" className="tile" aria-pressed={c.category === cat.category} onClick={() => onCategory(c.category)}>
              <span className="tile__icon"><Icon size={15} /></span>
              <span className="tile__name">{CATEGORY_LABELS[c.category]}</span>
              <span className="badge">{c.counts.APPROVED} approved</span>
              <span className="tile__how">{CATEGORY_HOW[c.category]}</span>
            </button>
          )
        })}
      </div>
      <p className="calc-estimate">
        <strong>{cat.counts.APPROVED} approved record(s) will be calculated</strong> · {CATEGORY_HOW[cat.category]}
        {Object.entries(cat.estimate).map(([line, t]) => <span key={line} className="badge">{LINE_LABELS[line as Line]}: {siteT(t ?? null)} tCO2e</span>)}
      </p>
      {waiting > 0 && (
        <p className="next next--problem next--block">
          {waiting} record(s) in this category are <strong>not</strong> included yet: {cat.counts.SUBMITTED} awaiting review, {cat.counts.RETURNED} returned, {cat.counts.DRAFT} draft.{' '}
          {cat.counts.SUBMITTED > 0 && <Link className="link" to="/review">Review them</Link>}
        </p>
      )}
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Facility · source</th><th>Dates</th><th className="num">Quantity</th><th>Status</th><th>Will give</th></tr></thead>
          <tbody>
            {cat.records.map((r) => (
              <tr key={r.id}>
                <td><Link className="link" to={`/activities/${r.id}`}>{r.facility} · {r.source}</Link>{r.activity && <div className="field__hint">{r.activity}</div>}</td>
                <td>{day(r.startDate)} to {day(r.endDate)}</td>
                <td className="num">{plain(r.quantity)} {r.unit}</td>
                <td><span className={`badge badge--${r.status.toLowerCase()}`}>{STATUS_LABELS[r.status]}</span></td>
                <td>
                  {r.status !== 'APPROVED' ? <span className="field__hint">Not included until approved</span>
                    : !r.calculable ? <span className="field__hint">No calculation method</span>
                    : r.results.map((x) => (
                      <div key={x.formulaCode}>
                        {x.status === 'BLOCKED' ? <span className="field__error">Blocked</span> : <><strong>{recordT(x.tCO2e)}</strong> <span className="field__hint">tCO2e · {LINE_LABELS[x.line]}</span></>}
                        {x.issues.length > 0 && <div className="field__hint" title={x.issues.map((i) => humanize(i.message)).join('\n')}>{x.issues.length} {x.issues.length === 1 ? 'note' : 'notes'} {x.issues.some((i) => i.severity === 'BLOCK') ? 'to fix' : ''}</div>}
                      </div>
                    ))}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

const CAUSE_LABEL: Record<string, string> = {
  ACTIVITY_DATA: 'Activity data corrected', FACTOR: 'Emission factor updated', GWP: 'GWP values changed', METHODOLOGY: 'Method changed',
  BOUNDARY: 'Boundary changed', ADDED: 'Newly included', REMOVED: 'No longer included', UNCHANGED: 'No change',
}
interface Comparison {
  gwpChanged: boolean; boundaryChanged: boolean; engineChanged: boolean; totalBefore: number; totalAfter: number; byCause: Record<string, number>; total: number
  rows: Array<{ activityRecordId: string; line: Line; facility: string; source: string; quantityBefore: string | null; quantityAfter: string | null; factorBefore: string | null; factorAfter: string | null
    formulaBefore: string | null; formulaAfter: string | null; tCO2eBefore: string | null; tCO2eAfter: string | null; change: number; causes: string[]; note: string | null }>
}
const signed = (n: number) => `${n > 0 ? '+' : ''}${n.toLocaleString(undefined, { maximumFractionDigits: 3 })}`

// Two runs side by side: every record whose result moved, and what moved it. Both runs stay exactly as they were.
function CompareRuns({ runs }: { runs: CalcRun[] }) {
  const label = (r: CalcRun) => `${new Date(r.createdAt).toLocaleString()} · ${r.runBy.name}`
  const [from, setFrom] = useState(runs[1].id)
  const [to, setTo] = useState(runs[0].id)
  const [open, setOpen] = useState(false)
  const { data, error } = useLoad<Comparison>(open && from !== to ? `/api/calculations/compare?from=${from}&to=${to}` : '')
  return (
    <details className="compare" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary className="field__label">Compare two runs</summary>
      <div className="filters">
        <select className="input" aria-label="Earlier run" value={from} onChange={(e) => setFrom(e.target.value)}>{runs.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}</select>
        <span aria-hidden>→</span>
        <select className="input" aria-label="Later run" value={to} onChange={(e) => setTo(e.target.value)}>{runs.map((r) => <option key={r.id} value={r.id}>{label(r)}</option>)}</select>
      </div>
      {from === to && <p className="status">Choose two different runs.</p>}
      {open && from !== to && <States error={error} loading={!data} />}
      {data && (
        <div className="stack stack--sm">
          <p><strong>{signed(data.totalAfter - data.totalBefore)} tCO2e</strong> in total ({data.totalBefore.toLocaleString(undefined, { maximumFractionDigits: 3 })} → {data.totalAfter.toLocaleString(undefined, { maximumFractionDigits: 3 })}).
            {data.gwpChanged && ' The GWP set differs between the runs.'}{data.boundaryChanged && ' A different boundary version applies.'}{data.engineChanged && ' The calculation engine version differs.'}</p>
          <div className="badges">{Object.entries(data.byCause).map(([c, v]) => <span key={c} className="badge badge--soft">{CAUSE_LABEL[c] ?? c}: {signed(v)} t</span>)}</div>
          {!data.rows.length ? <p className="status">No record's result changed.</p> : (
            <div className="table-wrap">
              <table className="table">
                <thead><tr><th>Record</th><th>Why</th><th>Quantity</th><th>Factor</th><th className="num">tCO2e before → after</th></tr></thead>
                <tbody>{data.rows.map((r) => (
                  <tr key={`${r.activityRecordId}${r.line}`}>
                    <td><Link className="link" to={`/activities/${r.activityRecordId}`}>{r.facility} · {r.source}</Link><div className="field__hint">{LINE_LABELS[r.line] ?? r.line}{r.formulaBefore !== r.formulaAfter ? ` · ${r.formulaBefore ?? '—'} → ${r.formulaAfter ?? '—'}` : ''}</div></td>
                    <td>{r.causes.map((c) => CAUSE_LABEL[c] ?? c).join(', ')}{r.note && <div className="field__hint">Last returned: {r.note}</div>}</td>
                    <td>{r.quantityBefore === r.quantityAfter ? r.quantityAfter : `${r.quantityBefore ?? '—'} → ${r.quantityAfter ?? '—'}`}</td>
                    <td className="field__hint">{r.factorBefore === r.factorAfter ? r.factorAfter : <>{r.factorBefore ?? '—'}<br />→ {r.factorAfter ?? '—'}</>}</td>
                    <td className="num">{r.tCO2eBefore ? Number(r.tCO2eBefore).toFixed(3) : '—'} → {r.tCO2eAfter ? Number(r.tCO2eAfter).toFixed(3) : '—'}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          )}
          {data.total > data.rows.length && <p className="field__hint">Showing the {data.rows.length} largest changes of {data.total}.</p>}
        </div>
      )}
    </details>
  )
}
