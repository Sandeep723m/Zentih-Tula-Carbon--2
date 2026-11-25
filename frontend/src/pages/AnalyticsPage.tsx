import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { ChartColumn, ChartSpline } from 'lucide-react'
import { ChartCard, Columns, Delta, Donut, fmt, Gauge, HBars, Line, SEQ, SERIES_COLORS, type Series } from '../components/charts'
import { Header, States } from '../components/Page'
import { useLoad } from '../hooks/useLoad'
import { day } from '../services/format'
import { CATEGORY_LABELS, type SourceCategory } from '../types/api'

type Totals = Partial<Record<string, { gross: string; counted: string | null }>>
interface Analytics {
  periods: Array<{ id: string; name: string; startDate: string; status: 'OPEN' | 'LOCKED'; run: { id: string; createdAt: string; final: boolean; gwpSet: string; boundary: boolean; totals: Totals | null } | null }>
  selected: null | {
    periodId: string; runId?: string
    byCategory?: Array<{ category: SourceCategory; lines: Record<string, string> }>
    byFacility?: Array<{ id: string; name: string; gross: Record<string, string>; counted: Record<string, string> }>
    bySource?: Array<{ id: string; name: string; facility: string; category: SourceCategory; lines: Record<string, string> }>
    monthly?: Array<{ month: string; lines: Record<string, string> }>
  }
}

const n = (v: string | null | undefined) => (v == null ? 0 : Number(v))
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const monthLabel = (m: string) => `${MONTHS[Number(m.slice(5)) - 1]} ${m.slice(2, 4)}`

// Emissions at a glance for one reporting year, compared with earlier years. Figures come from the stored
// calculation run (the final one when the year is locked). Scope 2 is shown on ONE basis at a time,
// location- or market-based, never added together.
export default function AnalyticsPage() {
  const [params, setParams] = useSearchParams()
  const navigate = useNavigate()
  const periodId = params.get('period') ?? ''
  const basis = params.get('basis') === 'market' ? 'market' : 'location'
  const share = params.get('share') === 'counted' ? 'counted' : 'gross'
  const set = (k: string, v: string) => { const p = new URLSearchParams(params); if (v) p.set(k, v); else p.delete(k); setParams(p) }
  const a = useLoad<Analytics>(`/api/analytics${periodId ? `?reportingPeriodId=${periodId}` : ''}`)
  const d = a.data
  if (!d) return <><Header title="Analytics" /><States error={a.error} loading /></>

  const S2 = basis === 'market' ? 'SCOPE2_MARKET' : 'SCOPE2_LOCATION'
  const S2_LABEL = `Scope 2 electricity (${basis}-based)`
  const withRun = d.periods.filter((p) => p.run)
  const sel = d.periods.find((p) => p.id === d.selected?.periodId)
  const idx = withRun.findIndex((p) => p.id === sel?.id)
  const prev = idx > 0 ? withRun[idx - 1] : null
  const t = (p: typeof sel, line: string) => {
    const x = p?.run?.totals?.[line]
    return x ? (share === 'counted' ? n(x.counted ?? x.gross) : n(x.gross)) : 0
  }
  const series: Series[] = [
    { key: 'SCOPE1', label: 'Scope 1', color: SERIES_COLORS[0] },
    { key: S2, label: S2_LABEL, color: SERIES_COLORS[1] },
    { key: 'SCOPE2_HEAT', label: 'Scope 2 steam, heat, cooling', color: SERIES_COLORS[2] },
  ]
  const sum = (lines: Record<string, string>) => n(lines.SCOPE1) + n(lines[S2]) + n(lines.SCOPE2_HEAT)

  const kpis = [
    { label: 'Scope 1', line: ['SCOPE1'] },
    { label: S2_LABEL, line: [S2] },
    { label: 'Scope 2 steam, heat, cooling', line: ['SCOPE2_HEAT'] },
    { label: `Scope 1 + 2 (${basis}-based)`, line: ['SCOPE1', S2, 'SCOPE2_HEAT'] },
  ].map((k) => {
    const now = k.line.reduce((s, l) => s + t(sel, l), 0)
    const before = prev ? k.line.reduce((s, l) => s + t(prev, l), 0) : null
    return { ...k, now, before }
  })

  const s = d.selected
  const cats = (s?.byCategory ?? []).map((c) => ({ key: c.category, label: CATEGORY_LABELS[c.category], values: [sum(c.lines)] })).filter((r) => r.values[0] > 0).sort((x, y) => y.values[0] - x.values[0])
  const facilities = (s?.byFacility ?? []).map((f) => {
    const src = share === 'counted' ? f.counted : f.gross
    return { key: f.id, label: f.name, values: series.map((x) => n(src[x.key])) }
  }).sort((x, y) => y.values.reduce((p, q) => p + q, 0) - x.values.reduce((p, q) => p + q, 0))
  const sources = (s?.bySource ?? []).map((x) => ({ key: x.id, label: x.name, sublabel: `${x.facility} · ${CATEGORY_LABELS[x.category]}`, total: sum(x.lines) }))
    .filter((r) => r.total > 0).sort((x, y) => y.total - x.total)
  const years = withRun.slice(-5).map((p) => ({ key: p.id, label: p.name, values: series.map((x) => t(p, x.key)) }))
  const loc = t(sel, 'SCOPE2_LOCATION'), mkt = t(sel, 'SCOPE2_MARKET')
  const biogenic = t(sel, 'BIOGENIC_MEMO'), removals = t(sel, 'REMOVALS')
  const total = kpis[3].now
  const SHORT = ['Scope 1', 'Scope 2 electricity', 'Steam & heat']
  const parts = series.map((x, i) => ({ key: x.key, label: x.label, short: SHORT[i], value: kpis[i].now, before: kpis[i].before, color: x.color }))

  return (
    <>
      <Header title="Analytics" subtitle="Trends and comparisons from your calculated emissions." />

      <div className="filters">
        <select className="input" aria-label="Reporting year" value={sel?.id ?? ''} onChange={(e) => set('period', e.target.value)}>
          {d.periods.map((p) => <option key={p.id} value={p.id}>{p.name}{!p.run ? ' (not calculated)' : p.run.final ? ' (final)' : ' (provisional)'}</option>)}
        </select>
        <div className="seg-toggle" role="group" aria-label="Scope 2 basis">
          <button type="button" aria-pressed={basis === 'location'} onClick={() => set('basis', '')}>Location-based</button>
          <button type="button" aria-pressed={basis === 'market'} onClick={() => set('basis', 'market')}>Market-based</button>
        </div>
        <div className="seg-toggle" role="group" aria-label="Share">
          <button type="button" aria-pressed={share === 'gross'} onClick={() => set('share', '')}>Gross</button>
          <button type="button" aria-pressed={share === 'counted'} onClick={() => set('share', 'counted')} disabled={!sel?.run?.boundary}>Counted under boundary</button>
        </div>
        {sel?.run && <span className="field__hint filters__end">Run of {new Date(sel.run.createdAt).toLocaleString()}</span>}
      </div>

      {!d.periods.length && <p className="status">No reporting periods yet.</p>}
      {sel && !sel.run && <p className="status">{sel.name} has not been calculated yet. Run its calculation on the Calculations page to see it here.</p>}

      {sel?.run && s && (
        <>
          <div className="an-grid">
            {/* ---- Total emissions ---- */}
            <section className="card an-card">
              <header className="an-card__head">
                <div className="an-card__heading">
                  <div className="an-card__titleline">
                    <h2 className="an-card__title">Total CO₂e Emissions</h2>
                    <span className="badge">GWP {sel.run.gwpSet}</span>
                    <span className={`badge ${sel.run.final ? 'badge--success' : 'badge--warning'}`}>{sel.run.final ? 'Final' : 'Provisional'}</span>
                  </div>
                  <p className="an-card__sub">{sel.name} · Scope 1 and 2 ({basis}-based) · {share === 'counted' ? 'counted under the approved boundary' : 'gross, 100% of every facility'}</p>
                </div>
              </header>
              <div className="an-total">
                <div className="an-total__donut">
                  <Donut parts={parts}>
                    <span className="donut__value">{compactT(total)}</span>
                    <span className="donut__unit">tCO₂e</span>
                    <Delta now={total} before={kpis[3].before} />
                  </Donut>
                  <div className="an-legend">
                    {parts.map((p) => <span key={p.key} className="an-legend__item"><span className="an-dot" data-color={p.key} />{p.short} ({pctOf(p.value, total)})</span>)}
                  </div>
                </div>
                <div className="an-rows">
                  <div className="an-row an-row--lead">
                    <div className="an-row__top"><strong>Total gross emissions</strong><span className="an-row__value">{fmt(total)} tCO₂e <Delta now={total} before={kpis[3].before} /></span></div>
                    <p className="an-row__note">Scope 1 plus Scope 2 ({basis}-based electricity and purchased steam, heat and cooling).</p>
                  </div>
                  {parts.map((p) => (
                    <div key={p.key} className="an-row">
                      <div className="an-row__top"><span>{p.label}</span><span className="an-row__value">{fmt(p.value)} t ({pctOf(p.value, total)}) <Delta now={p.value} before={p.before} /></span></div>
                      <progress className={`an-bar an-bar--${p.key.toLowerCase()}`} max={total || 1} value={p.value} aria-label={`${p.label} share`} />
                    </div>
                  ))}
                </div>
              </div>
              <div className="an-tiles">
                <div className="an-tile">
                  <span className="an-tile__label">{prev ? `Previous year (${prev.name})` : 'Previous year'}</span>
                  <strong className="an-tile__value">{prev ? `${compactT(kpis[3].before ?? 0)} t` : '—'}</strong>
                  {prev ? <Delta now={total} before={kpis[3].before} suffix="vs this year" /> : <span className="an-tile__hint">Not calculated yet</span>}
                </div>
                <div className="an-tile">
                  <span className="an-tile__label">Biogenic CO₂</span>
                  <strong className="an-tile__value">{compactT(biogenic)} t</strong>
                  <span className="an-tile__hint">Reported separately</span>
                </div>
                <div className="an-tile">
                  <span className="an-tile__label">Carbon removals</span>
                  <strong className="an-tile__value">{compactT(removals)} t</strong>
                  <span className="an-tile__hint">Not deducted from totals</span>
                </div>
              </div>
            </section>

            {/* ---- Scope 2 electricity ---- */}
            <section className="card an-card">
              <header className="an-card__head">
                <div className="an-card__heading">
                  <div className="an-card__titleline"><h2 className="an-card__title">Scope 2 Electricity</h2><span className="badge badge--soft">Dual reporting</span></div>
                  <p className="an-card__sub">Market-based against the location-based grid figure</p>
                </div>
              </header>
              <Gauge pct={loc ? mkt / loc : 0}>
                <span className="gauge__value">{compactT(mkt)}</span>
                <span className="gauge__label">tCO₂e market-based</span>
              </Gauge>
              <p className="an-pill">{loc > 0 && mkt < loc ? `Certificates and contracts lower it by ${(((loc - mkt) / loc) * 100).toFixed(1)}%` : 'No reduction from certificates this year'}</p>
              <div className="an-chips">
                <span className="an-chip"><span className="an-dot" data-color="SCOPE2_LOCATION" />Location-based <strong>{fmt(loc)}</strong></span>
                <span className="an-chip"><span className="an-dot" data-color="SCOPE2_MARKET" />Market-based <strong>{fmt(mkt)}</strong></span>
                <span className="an-chip"><span className="an-dot" data-color="SCOPE2_HEAT" />Steam, heat, cooling <strong>{fmt(kpis[2].now)}</strong></span>
                <span className="an-chip"><span className="an-dot" data-color="REDUCTION" />Reduction <strong>{fmt(Math.max(loc - mkt, 0))}</strong></span>
              </div>
            </section>

            {/* ---- Over months ---- */}
            <MonthsCard monthly={s.monthly ?? []} series={series} />

            {/* ---- Top emitters ---- */}
            <TopEmitters sources={sources} facilities={facilities.map((f) => ({ key: f.key, label: f.label, total: f.values.reduce((a2, b) => a2 + b, 0) }))} total={total} />
          </div>

          <div className="viz-grid-layout">
            <ChartCard title="Where the emissions come from" hint={`By category, gross tCO2e (Scope 1 + ${S2_LABEL.toLowerCase()} + steam). Click a bar to see its records.`}
              table={{ head: ['Category', 'tCO2e'], rows: cats.map((c) => [c.label, c.values[0]]) }}>
              {cats.length ? <HBars rows={cats} series={[{ key: 'v', label: 'tCO2e', color: SEQ }]} onRow={(c) => navigate(`/calculations?period=${sel.id}&filter=category%3D${c}`)} /> : <p className="status">No emissions.</p>}
            </ChartCard>

            <YearOnYear current={sel.name} previous={prev?.name ?? null}
              rows={[...kpis.slice(0, 3).map((k, i) => ({ key: series[i].key, label: k.label, color: series[i].color, now: k.now, before: k.before })),
                { key: 'TOTAL', label: `Total Scope 1 + 2 (${basis}-based)`, color: SEQ, now: kpis[3].now, before: kpis[3].before }]}
              years={years.map((y) => ({ key: y.key, label: y.label, values: [y.values.reduce((a2, b) => a2 + b, 0)] }))} />

            <ChartCard title="Facilities by scope" wide hint={share === 'counted' ? 'Counted under the approved boundary (ownership share applied).' : 'Gross includes 100% of every facility.'}
              table={{ head: ['Facility', ...series.map((x) => x.label), 'Total'], rows: facilities.map((f) => [f.label, ...f.values, f.values.reduce((a2, b) => a2 + b, 0)]) }}>
              <HBars rows={facilities} series={series} />
            </ChartCard>
          </div>
          <p className="field__hint">Run date {day(sel.run.createdAt)}. Exact figures, warnings and factors: Reports and Calculations.</p>
        </>
      )}
    </>
  )
}

const pctOf = (v: number, total: number) => `${total ? Math.round((v / total) * 100) : 0}%`
const compactT = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e4 ? `${(v / 1e3).toFixed(1)}k` : fmt(v))

function MonthsCard({ monthly, series }: { monthly: Array<{ month: string; lines: Record<string, string> }>; series: Series[] }) {
  const [scope, setScope] = useState('')
  const [kind, setKind] = useState<'line' | 'bars'>('line')
  const value = (lines: Record<string, string>) => (scope ? n(lines[scope]) : series.reduce((a, x) => a + n(lines[x.key]), 0))
  const points = monthly.map((m) => ({ key: m.month, label: monthLabel(m.month), value: value(m.lines) }))
  const label = scope ? series.find((x) => x.key === scope)!.label : 'Scope 1 + 2'
  return (
    <section className="card an-card">
      <header className="an-card__head">
        <div className="an-card__heading">
          <div className="an-card__titleline"><h2 className="an-card__title">Total Emissions over Months</h2><span className="badge badge--soft">Monthly</span></div>
          <p className="an-card__sub">A record covering several months is spread evenly over its dates</p>
        </div>
        <div className="cluster">
          <div className="seg-toggle seg-toggle--icons" role="group" aria-label="Chart type">
            <button type="button" aria-pressed={kind === 'line'} aria-label="Line" onClick={() => setKind('line')}><ChartSpline size={15} /></button>
            <button type="button" aria-pressed={kind === 'bars'} aria-label="Columns" onClick={() => setKind('bars')}><ChartColumn size={15} /></button>
          </div>
          <select className="input input--sm" aria-label="Scope" value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">All scopes</option>
            {series.map((x) => <option key={x.key} value={x.key}>{x.label}</option>)}
          </select>
        </div>
      </header>
      {!points.length ? <p className="status">No data.</p>
        : kind === 'line' ? <Line points={points} label={label} />
        : <Columns groups={points.map((p) => ({ key: p.key, label: p.label, values: [p.value] }))} series={[{ key: 'v', label, color: SEQ }]} />}
    </section>
  )
}

function TopEmitters({ sources, facilities, total }: { sources: Array<{ key: string; label: string; sublabel: string; total: number }>; facilities: Array<{ key: string; label: string; total: number }>; total: number }) {
  const [by, setBy] = useState<'sources' | 'facilities'>('facilities')
  const rows = (by === 'sources' ? sources : facilities.map((f) => ({ ...f, sublabel: 'Facility' }))).filter((r) => r.total > 0).slice(0, 5)
  const max = Math.max(...rows.map((r) => r.total), 0)
  return (
    <section className="card an-card">
      <header className="an-card__head">
        <div className="an-card__heading">
          <h2 className="an-card__title">Top 5 Emitters (tCO₂e)</h2>
          <p className="an-card__sub">Where to focus reduction effort first</p>
        </div>
        <div className="seg-toggle" role="group" aria-label="Group by">
          <button type="button" aria-pressed={by === 'sources'} onClick={() => setBy('sources')}>Sources</button>
          <button type="button" aria-pressed={by === 'facilities'} onClick={() => setBy('facilities')}>Facilities</button>
        </div>
      </header>
      {!rows.length ? <p className="status">No emissions yet.</p> : (
        <ol className="an-emitters">
          {rows.map((r, i) => (
            <li key={r.key} className="an-emitter">
              <div className="an-emitter__top">
                <span className="an-rank">{String(i + 1).padStart(2, '0')}</span>
                <span className="an-emitter__name">{r.label}</span>
                <strong className="an-emitter__value">{fmt(r.total)} <span className="muted text-xs">t</span></strong>
              </div>
              <progress className="an-bar an-bar--primary" max={max || 1} value={r.total} aria-label={`${r.label} relative size`} />
              <div className="an-emitter__foot">
                <span className="muted text-xs">{r.sublabel}</span>
                <span className="badge badge--soft">{pctOf(r.total, total)} of total</span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

// Selected year against the previous calculated year, scope by scope: paired bars, the change in tonnes and in %.
function YearOnYear({ current, previous, rows, years }: {
  current: string; previous: string | null
  rows: Array<{ key: string; label: string; color: string; now: number; before: number | null }>
  years: Array<{ key: string; label: string; values: number[] }>
}) {
  return (
    <section className="card an-card viz-card--wide">
      <header className="an-card__head">
        <div className="an-card__heading">
          <div className="an-card__titleline"><h2 className="an-card__title">Year-on-Year Comparison</h2>{previous && <span className="badge badge--soft">{previous} → {current}</span>}</div>
          <p className="an-card__sub">{previous ? `How ${current} compares with ${previous}, scope by scope. Green means emissions fell.` : 'Only one calculated year so far. Calculate an earlier year to compare.'}</p>
        </div>
        {previous && (
          <div className="yoy-legend">
            <span><span className="yoy-key yoy-key--prev" />{previous}</span>
            <span><span className="yoy-key" />{current}</span>
          </div>
        )}
      </header>
      {previous && (
        <div className="yoy">
          {rows.map((r) => {
            const diff = r.now - (r.before ?? 0)
            const max = Math.max(r.now, r.before ?? 0) || 1 // each row compares its own two years
            return (
              <div key={r.key} className={`yoy-row ${r.key === 'TOTAL' ? 'yoy-row--total' : ''}`}>
                <div className="yoy-row__label"><span className="an-dot" data-color={r.key} />{r.label}</div>
                <div className="yoy-row__bars">
                  <div className="yoy-bar"><progress className="an-bar an-bar--prev" max={max} value={r.before ?? 0} aria-label={`${previous}`} /><span>{fmt(r.before ?? 0)}</span></div>
                  <div className="yoy-bar"><progress className={`an-bar an-bar--${r.key.toLowerCase()}`} max={max} value={r.now} aria-label={`${current}`} /><span>{fmt(r.now)}</span></div>
                </div>
                <div className="yoy-row__change">
                  <strong className={diff > 0 ? 'text-error' : diff < 0 ? 'text-success' : 'muted'}>{diff > 0 ? '+' : ''}{fmt(diff)} t</strong>
                  {r.before ? <Delta now={r.now} before={r.before} /> : <span className="muted text-xs">{r.now ? 'new this year' : 'no change'}</span>}
                </div>
              </div>
            )
          })}
        </div>
      )}
      {years.length > 1 && (
        <div className="stack stack--sm">
          <h3 className="card__subtitle">Total by year</h3>
          <Columns groups={years} series={[{ key: 'total', label: 'Scope 1 + 2 total', color: SEQ }]} />
        </div>
      )}
    </section>
  )
}
