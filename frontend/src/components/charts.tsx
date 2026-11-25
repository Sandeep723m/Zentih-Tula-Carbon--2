// Small chart kit for Analytics: horizontal bars (single or stacked), grouped columns and a line.
// Specs follow the data-viz method: thin marks with 4px rounded data ends, a 2px surface gap between
// touching fills, hairline recessive grid, text in text colours (never the series colour), a legend for
// two or more series, a tooltip on hover AND keyboard focus, and a table view so nothing is hover-only.
import { useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'

export interface Series { key: string; label: string; color: string }
export const SERIES_COLORS = ['var(--series-1)', 'var(--series-2)', 'var(--series-3)'] // validated as a set; fixed order
export const SEQ = 'var(--chart-primary)' // single-series charts: one hue

export const fmt = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: Math.abs(v) >= 1000 ? 0 : 2 })
const compact = (v: number) => (Math.abs(v) >= 1e6 ? `${(v / 1e6).toFixed(1)}M` : Math.abs(v) >= 1e3 ? `${(v / 1e3).toFixed(v >= 1e4 ? 0 : 1)}K` : `${Math.round(v)}`)
// Clean axis ticks: 0 … max rounded up to 1/2/5 × 10^n.
function ticks(max: number, n = 4) {
  if (max <= 0) return [0]
  const raw = max / n
  const p = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * p).find((s) => s >= raw)!
  return Array.from({ length: Math.ceil(max / step) + 1 }, (_, i) => i * step)
}

// The chart's rendered width, so SVG text draws at its real size instead of scaling with the card.
function useWidth(ref: React.RefObject<HTMLElement | null>, fallback: number) {
  const [w, setW] = useState(fallback)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, Math.round(e.contentRect.width))))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return w
}

// One tooltip per chart; content is React text (never HTML strings).
function useTip() {
  const box = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<{ x: number; y: number; body: ReactNode } | null>(null)
  const show = (target: Element, body: ReactNode) => {
    const b = box.current?.getBoundingClientRect(), r = target.getBoundingClientRect()
    if (b) setTip({ x: r.left - b.left + r.width / 2, y: r.top - b.top, body })
  }
  const el = tip && <div className="viz-tip" style={{ left: tip.x, top: tip.y }} role="status">{tip.body}</div>
  return { box, show, hide: () => setTip(null), el }
}

const TipRow = ({ color, label, value, unit }: { color: string; label: string; value: number; unit: string }) => (
  <div className="viz-tip__row"><span className="viz-key" style={{ background: color }} /><strong>{fmt(value)}</strong> {unit} <span className="viz-muted">{label}</span></div>
)

export const Legend = ({ series }: { series: Series[] }) => series.length < 2 ? null : (
  <div className="viz-legend">{series.map((s) => <span key={s.key}><span className="viz-swatch" style={{ background: s.color }} />{s.label}</span>)}</div>
)

// ---- Horizontal bars: one row per item, segments stacked when there are several series ----------------
export interface BarRow { key: string; label: string; sublabel?: string; values: number[] }
export function HBars({ rows, series, unit = 'tCO2e', onRow }: { rows: BarRow[]; series: Series[]; unit?: string; onRow?: (key: string) => void }) {
  const { box, ...t } = useTip()
  const max = Math.max(...rows.map((r) => r.values.reduce((a, b) => a + b, 0)), 0)
  return (
    <div className="viz" ref={box} onPointerLeave={t.hide}>
      <Legend series={series} />
      <div className="viz-bars">
        {rows.map((r) => {
          const total = r.values.reduce((a, b) => a + b, 0)
          const body = <><div className="viz-tip__title">{r.label}</div>{series.map((s, i) => r.values[i] ? <TipRow key={s.key} color={s.color} label={s.label} value={r.values[i]} unit={unit} /> : null)}</>
          return (
            <div key={r.key} className={`viz-bar-row ${onRow ? 'viz-bar-row--click' : ''}`} tabIndex={0} aria-label={`${r.label}: ${fmt(total)} ${unit}`}
              onPointerMove={(e) => t.show(e.currentTarget.querySelector('.viz-track')!, body)} onFocus={(e) => t.show(e.currentTarget.querySelector('.viz-track')!, body)} onBlur={t.hide}
              onClick={() => onRow?.(r.key)} onKeyDown={(e) => { if (onRow && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); onRow(r.key) } }}>
              <div className="viz-bar-label">{r.label}{r.sublabel && <span className="viz-muted"> · {r.sublabel}</span>}</div>
              <div className="viz-track">
                <div className="viz-stack" style={{ width: max ? `${(total / max) * 100}%` : 0 }}>
                  {series.map((s, i) => r.values[i] > 0 && <div key={s.key} className="viz-seg" style={{ flexGrow: r.values[i], background: s.color }} />)}
                </div>
                <span className="viz-bar-value">{fmt(total)}</span>
              </div>
            </div>
          )
        })}
      </div>
      {t.el}
    </div>
  )
}

// ---- Grouped columns: one group per category (e.g. a year), one column per series ----------------------
export function Columns({ groups, series, unit = 'tCO2e' }: { groups: Array<{ key: string; label: string; values: number[] }>; series: Series[]; unit?: string }) {
  const { box, ...t } = useTip()
  const W = useWidth(box, 640), H = 260, L = 44, B = 28, T = 12
  const max = Math.max(...groups.flatMap((g) => g.values), 0)
  const tk = ticks(max), top = tk[tk.length - 1] || 1
  const y = (v: number) => T + (H - T - B) * (1 - v / top)
  const gw = (W - L) / Math.max(groups.length, 1)
  const bw = Math.min(24, (gw * 0.7) / series.length)
  return (
    <div className="viz" ref={box} onPointerLeave={t.hide}>
      <Legend series={series} />
      <svg viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label="Grouped column chart">
        {tk.map((v) => <g key={v}><line x1={L} x2={W} y1={y(v)} y2={y(v)} className="viz-grid" /><text x={L - 6} y={y(v) + 4} className="viz-axis" textAnchor="end">{compact(v)}</text></g>)}
        {groups.map((g, gi) => {
          const x0 = L + gi * gw + (gw - bw * series.length - 2 * (series.length - 1)) / 2
          const body = <><div className="viz-tip__title">{g.label}</div>{series.map((s, i) => <TipRow key={s.key} color={s.color} label={s.label} value={g.values[i]} unit={unit} />)}</>
          return (
            <g key={g.key} tabIndex={0} className="viz-hit" onPointerMove={(e) => t.show(e.currentTarget, body)} onFocus={(e) => t.show(e.currentTarget, body)} onBlur={t.hide} aria-label={`${g.label}: ${series.map((s, i) => `${s.label} ${fmt(g.values[i])}`).join(', ')}`}>
              <rect x={L + gi * gw} y={T} width={gw} height={H - T - B} fill="transparent" />
              {series.map((s, i) => {
                const h = Math.max(0, y(0) - y(g.values[i]))
                return h > 0 && <path key={s.key} d={roundTop(x0 + i * (bw + 2), y(g.values[i]), bw, h)} fill={s.color} />
              })}
              <text x={L + gi * gw + gw / 2} y={H - 8} className="viz-axis" textAnchor="middle">{g.label}</text>
            </g>
          )
        })}
        <line x1={L} x2={W} y1={y(0)} y2={y(0)} className="viz-baseline" />
      </svg>
      {t.el}
    </div>
  )
}
// Column with a 4px rounded data end and a square baseline.
const roundTop = (x: number, y: number, w: number, h: number) => {
  const r = Math.min(4, w / 2, h)
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`
}

// ---- Area over time (single series): smooth monotone curve, gradient fill, crosshair snaps to a point ----
// Monotone cubic (Fritsch–Carlson) so the curve never overshoots below zero or above a peak.
function smoothPath(pts: Array<[number, number]>) {
  if (pts.length < 3) return pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join(' ')
  const d = pts.slice(1).map(([x, y], i) => (y - pts[i][1]) / (x - pts[i][0]))
  const m = pts.map((_, i) => (i === 0 ? d[0] : i === pts.length - 1 ? d[i - 1] : d[i - 1] * d[i] <= 0 ? 0 : (d[i - 1] + d[i]) / 2))
  let path = `M${pts[0][0]},${pts[0][1]}`
  for (let i = 0; i < pts.length - 1; i++) {
    const [x0, y0] = pts[i], [x1, y1] = pts[i + 1], h = (x1 - x0) / 3
    path += ` C${x0 + h},${y0 + m[i] * h} ${x1 - h},${y1 - m[i + 1] * h} ${x1},${y1}`
  }
  return path
}

export function Line({ points, label, unit = 'tCO2e' }: { points: Array<{ key: string; label: string; value: number }>; label: string; unit?: string }) {
  const { box, ...t } = useTip()
  const [hover, setHover] = useState<number | null>(null)
  const gid = useId().replace(/:/g, '')
  const W = useWidth(box, 640), H = 280, L = 44, B = 28, T = 14, R = 16
  const max = Math.max(...points.map((p) => p.value), 0)
  const tk = ticks(max), top = tk[tk.length - 1] || 1
  const x = (i: number) => L + (points.length < 2 ? (W - L - R) / 2 : (i * (W - L - R)) / (points.length - 1))
  const y = (v: number) => T + (H - T - B) * (1 - v / top)
  const svg = useRef<SVGSVGElement>(null)
  const pick = (clientX: number) => {
    const b = svg.current!.getBoundingClientRect()
    const vx = ((clientX - b.left) / b.width) * W
    return points.reduce((best, _, i) => (Math.abs(x(i) - vx) < Math.abs(x(best) - vx) ? i : best), 0)
  }
  const showAt = (i: number) => {
    setHover(i)
    const dot = svg.current?.querySelector(`[data-i="${i}"]`)
    if (dot) t.show(dot, <><div className="viz-tip__title">{points[i].label}</div><TipRow color={SEQ} label={label} value={points[i].value} unit={unit} /></>)
  }
  const step = Math.ceil(points.length / 12)
  const pts = points.map((p, i) => [x(i), y(p.value)] as [number, number])
  const curve = smoothPath(pts)
  const last = points.length - 1
  return (
    <div className="viz" ref={box} onPointerLeave={() => { t.hide(); setHover(null) }}>
      <svg ref={svg} viewBox={`0 0 ${W} ${H}`} className="viz-svg" role="img" aria-label={`${label} over time`} tabIndex={0}
        onPointerMove={(e) => points.length && showAt(pick(e.clientX))}
        onKeyDown={(e) => { if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); showAt(Math.min(last, Math.max(0, (hover ?? -1) + (e.key === 'ArrowRight' ? 1 : -1)))) } }}
        onBlur={() => { t.hide(); setHover(null) }}>
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={SEQ} stopOpacity={0.28} />
            <stop offset="100%" stopColor={SEQ} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        {tk.map((v) => <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} className="viz-grid" /><text x={L - 8} y={y(v) + 4} className="viz-axis" textAnchor="end">{compact(v)}</text></g>)}
        {points.length > 0 && <path className="viz-area" d={`${curve} L${x(last)},${y(0)} L${x(0)},${y(0)}Z`} fill={`url(#${gid})`} />}
        <path className="viz-line" d={curve} fill="none" stroke={SEQ} strokeWidth={2.5} strokeLinejoin="round" strokeLinecap="round" />
        {last >= 0 && <line x1={x(hover ?? last)} x2={x(hover ?? last)} y1={T} y2={y(0)} className="viz-cross" strokeDasharray="3 4" />}
        {points.map((p, i) => <circle key={p.key} data-i={i} cx={x(i)} cy={y(p.value)} r={hover === i || (hover == null && i === last) ? 5 : 0} fill={SEQ} stroke="var(--color-surface)" strokeWidth={2} />)}
        {points.map((p, i) => i % step === 0 && <text key={p.key} x={x(i)} y={H - 8} className="viz-axis" textAnchor="middle">{p.label}</text>)}
      </svg>
      {t.el}
    </div>
  )
}

// ---- Donut: parts of a whole, round-capped segments with a small gap; figure in the middle ----------------
export interface Part { key: string; label: string; value: number; color: string }
export function Donut({ parts, children }: { parts: Part[]; children: ReactNode }) {
  const R = 78, C = 2 * Math.PI * R, GAP = parts.filter((p) => p.value > 0).length > 1 ? 10 : 0
  const total = parts.reduce((a, p) => a + p.value, 0)
  let offset = 0
  return (
    <div className="donut">
      <svg viewBox="0 0 200 200" className="donut__svg" role="img" aria-label={parts.map((p) => `${p.label} ${fmt(p.value)}`).join(', ')}>
        <circle cx="100" cy="100" r={R} fill="none" stroke="var(--chart-track)" strokeWidth="16" />
        {total > 0 && parts.filter((p) => p.value > 0).map((p) => {
          const len = Math.max((p.value / total) * C - GAP, 0.01)
          const el = <circle key={p.key} cx="100" cy="100" r={R} fill="none" stroke={p.color} strokeWidth="16" strokeLinecap="round"
            strokeDasharray={`${len} ${C}`} strokeDashoffset={-offset} transform="rotate(-90 100 100)"><title>{`${p.label}: ${fmt(p.value)} tCO2e`}</title></circle>
          offset += (p.value / total) * C
          return el
        })}
      </svg>
      <div className="donut__center">{children}</div>
    </div>
  )
}

// ---- Semicircle gauge: one value as a share of a reference -------------------------------------------------
export function Gauge({ pct, color = SEQ, children }: { pct: number; color?: string; children: ReactNode }) {
  const R = 80, half = Math.PI * R, p = Math.max(0, Math.min(1, pct))
  return (
    <div className="gauge">
      <svg viewBox="0 0 200 112" className="gauge__svg" aria-hidden="true">
        <path d="M20,100 A80,80 0 0 1 180,100" fill="none" stroke="var(--chart-track)" strokeWidth="16" strokeLinecap="round" />
        {p > 0 && <path d="M20,100 A80,80 0 0 1 180,100" fill="none" stroke={color} strokeWidth="16" strokeLinecap="round" strokeDasharray={`${p * half} ${half}`} />}
      </svg>
      <div className="gauge__center">{children}</div>
    </div>
  )
}

// ---- Change vs an earlier figure: down is good for emissions -----------------------------------------------
export function Delta({ now, before, suffix = '' }: { now: number; before: number | null | undefined; suffix?: string }) {
  if (before == null || before === 0) return null
  const pct = ((now - before) / before) * 100
  const down = pct <= 0
  const Icon = down ? ArrowDownRight : ArrowUpRight
  return <span className={`delta ${down ? 'delta--down' : 'delta--up'}`}><Icon size={12} />{down ? '' : '+'}{pct.toFixed(1)}%{suffix && ` ${suffix}`}</span>
}

// A chart card: title, one-line explanation, the chart, and a table view of the same numbers.
export function ChartCard({ title, hint, table, children, wide = false }: { title: string; hint?: string; table: { head: string[]; rows: Array<Array<string | number>> }; children: ReactNode; wide?: boolean }) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`card viz-card ${wide ? 'viz-card--wide' : ''}`}>
      <header className="viz-card__head">
        <div className="stack stack--xs"><h2 className="viz-card__title">{title}</h2>{hint && <p className="field__hint">{hint}</p>}</div>
        <button type="button" className="button button--ghost button--small no-print" onClick={() => setAsTable((v) => !v)}>{asTable ? 'Chart' : 'Table'}</button>
      </header>
      {asTable ? (
        <div className="table-wrap">
          <table className="table">
            <thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
            <tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={typeof c === 'number' ? 'num' : undefined}>{typeof c === 'number' ? fmt(c) : c}</td>)}</tr>)}</tbody>
          </table>
        </div>
      ) : children}
    </section>
  )
}
