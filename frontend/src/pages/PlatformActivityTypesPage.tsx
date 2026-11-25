import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { Pencil, RotateCcw, Search, ShieldCheck } from 'lucide-react'
import { useDialog } from '../components/Dialog'
import { Header, Skeleton, States } from '../components/Page'
import { Pager, type Page } from '../components/Pager'
import { Tabs } from '../components/Tabs'
import { Notify } from '../components/Toast'
import { useLoad } from '../hooks/useLoad'
import { apiPatch } from '../services/apiClient'
import { plain } from '../services/format'

interface Row { code: string; name: string; category: string; scope: number; formulaCode: string | null; allowedUnits: string[]; measuredIn: string; changed: boolean }
interface FormulaOption { code: string | null; title: string; units: string[] }
interface Detail {
  code: string; name: string; category: string; scope: number; carbonOrigin: string; measuredIn: string; defaultNcv: string | null; notes: string | null
  formulaCode: string | null; formulaTitle: string | null; equation: string[]; inputs: string[]; allowedUnits: string[]
  units: Array<{ code: string; name: string; dimension: string; toBase: string; baseUnit: string }>
  workbook: { formulaCode: string | null; allowedUnits: string[]; formulaTitle: string | null }
  changed: boolean
  usage: { sources: number; records: number; byUnit: Record<string, number> }
  options: { formulas: FormulaOption[]; allUnits: Array<{ code: string; name: string; dimension: string }>; locked: Record<string, string> }
  history: Array<{ id: string; createdAt: string; actor: string | null; reason: string | null; before: { formulaCode: string | null; allowedUnits: string[] } | null; after: { formulaCode: string | null; allowedUnits: string[] } | null }>
}
const formulaLabel = (code: string | null) => code ?? 'Not calculated'
// One short line per row: the workbook unit first, then how many more.
const unitSummary = (r: Row) => {
  if (!r.allowedUnits.length) return 'any unit'
  const first = r.allowedUnits.includes(r.measuredIn) ? r.measuredIn : r.allowedUnits[0]
  return r.allowedUnits.length === 1 ? first : `${first} + ${r.allowedUnits.length - 1} more unit${r.allowedUnits.length === 2 ? '' : 's'}`
}

// Super Admin: the formula and units behind every activity in the workbook, and controlled changes to them.
export default function PlatformActivityTypesPage() {
  const [params, setParams] = useSearchParams()
  const q = params.get('q') ?? ''
  const category = params.get('category') ?? ''
  const changed = params.get('changed') ?? ''
  const page = params.get('page') ?? '1'
  const selected = params.get('code') ?? ''
  const [search, setSearch] = useState(q)
  const list = useLoad<Page<Row> & { counts: Record<string, number>; changedCount: number }>(
    `/api/platform/activity-types?page=${page}${q ? `&q=${encodeURIComponent(q)}` : ''}${category ? `&category=${encodeURIComponent(category)}` : ''}${changed ? '&changed=1' : ''}`)
  const go = (next: Record<string, string>) => setParams(Object.fromEntries(Object.entries({ q, category, changed, code: selected, ...next }).filter(([, v]) => v)))
  const total = list.data ? Object.values(list.data.counts).reduce((a, b) => a + b, 0) : undefined

  return (
    <>
      <Header title="Activities, Formulas & Units" subtitle="The formula that calculates each activity, and the units it accepts." />
      <div className="callout">
        <ShieldCheck size={18} />
        <span><strong>Changes are controlled.</strong> <em>Changes apply from the next calculation.</em></span>
      </div>
      <section className="card">
        <form className="filters" onSubmit={(e) => { e.preventDefault(); go({ q: search.trim(), page: '', code: '' }) }}>
          <div className="search-input">
            <Search size={15} />
            <input className="input" placeholder="Search by activity, code or category (e.g. diesel, R-410A)…" value={search} onChange={(e) => setSearch(e.target.value)} aria-label="Search activities" />
          </div>
          <button className="button button--ghost" type="submit">Search</button>
        </form>
        <Tabs label="Categories" active={changed ? 'changed' : category} onChange={(k) => go(k === 'changed' ? { changed: '1', category: '', page: '', code: '' } : { category: k, changed: '', page: '', code: '' })} tabs={[
          { key: '', label: 'All', count: total },
          ...Object.entries(list.data?.counts ?? {}).map(([k, n]) => ({ key: k, label: k, count: n })),
          { key: 'changed', label: 'Changed from default', count: list.data?.changedCount, alert: !!list.data?.changedCount },
        ]} />
      </section>
      <div className="formulas">
        <section className="card">
          <States error={list.error} loading={!list.data} empty={list.data?.total === 0 && (changed ? 'Every activity uses its default formula and units.' : 'No activities match.')} />
          {!!list.data?.rows.length && (
            <ul className="list">
              {list.data.rows.map((r) => (
                <li key={r.code}>
                  <button type="button" className={`list__item formulas__row ${r.code === selected ? 'is-selected' : ''}`} onClick={() => go({ code: r.code })}>
                    <span className="formulas__main">
                      <span className="list__title formulas__name">{r.name}</span>
                      <span className="list__meta">{r.code} · Scope {r.scope} · {unitSummary(r)}</span>
                    </span>
                    <span className="formulas__badges">
                      {r.changed && <span className="badge badge--warning">Changed</span>}
                      <span className={`badge ${r.formulaCode ? 'badge--soft' : ''}`}>{formulaLabel(r.formulaCode)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.data && <Pager data={list.data} onPage={(n) => go({ page: String(n) })} />}
        </section>
        {selected
          ? <ActivityDetail key={selected} code={selected} onChanged={list.reload} />
          : <section className="card empty-state"><p>Select an activity to see its formula and units.</p></section>}
      </div>
    </>
  )
}

function ActivityDetail({ code, onChanged }: { code: string; onChanged: () => void }) {
  const { data: d, error, reload } = useLoad<Detail>(`/api/platform/activity-types/${encodeURIComponent(code)}`)
  const [editing, setEditing] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  if (!d) return <section className="card">{error ? <States error={error} loading={false} /> : <Skeleton />}</section>
  const saved = (msg: string) => { setEditing(false); setNotice(msg); reload(); onChanged() }

  return (
    <section className="card stack">
      <Notify message={notice} />
      <div className="card__headline card__headline--top">
        <div>
          <h2 className="card__title">{d.name}</h2>
          <p className="field__hint">{d.code} · {d.category} · Scope {d.scope} · {d.carbonOrigin} · default unit {d.measuredIn}{d.defaultNcv && ` · default NCV ${plain(d.defaultNcv)} TJ/t`}</p>
        </div>
        {d.changed ? <span className="badge badge--warning">Changed from default</span> : <span className="badge badge--success">Default</span>}
      </div>

      <div className="formulas__block">
        <h3 className="formulas__heading">Formula</h3>
        {d.formulaCode ? (
          <>
            <p><span className="badge badge--soft">{d.formulaCode}</span> {d.formulaTitle}</p>
            <ol className="formulas__steps">{d.equation.map((line) => <li key={line}>{line}</li>)}</ol>
            {!!d.inputs.length && <p className="field__hint">Extra inputs on the entry form: {d.inputs.join('; ')}.</p>}
          </>
        ) : <p className="field__hint">Not calculated. Records of this activity are kept but give no emissions until a formula applies.</p>}
      </div>

      <div className="formulas__block">
        <h3 className="formulas__heading">Units accepted</h3>
        {d.units.length ? (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Unit</th><th>Name</th><th>Type</th><th>Equals</th><th className="num">Records using it</th></tr></thead>
              <tbody>{d.units.map((u) => (
                <tr key={u.code}><td><strong>{u.code}</strong></td><td>{u.name}</td><td>{u.dimension}</td><td className="nowrap">1 {u.code} = {plain(u.toBase)} {u.baseUnit}</td><td className="num">{d.usage.byUnit[u.code] ?? 0}</td></tr>
              ))}</tbody>
            </table>
          </div>
        ) : <p className="field__hint">Any unit is accepted (not calculated).</p>}
        <p className="field__hint">Used by {d.usage.sources} emission source{d.usage.sources === 1 ? '' : 's'} and {d.usage.records} record{d.usage.records === 1 ? '' : 's'} across all organisations.</p>
      </div>

      {d.changed && (
        <div className="callout">
          <span className="callout__text"><strong>Default:</strong> {formulaLabel(d.workbook.formulaCode)}{d.workbook.formulaTitle && ` (${d.workbook.formulaTitle})`}; units {d.workbook.allowedUnits.join(', ') || 'any'}.</span>
        </div>
      )}

      {editing
        ? <EditActivity d={d} onCancel={() => setEditing(false)} onSaved={saved} />
        : <div className="actions"><button type="button" className="button button--ghost" onClick={() => { setEditing(true); setNotice(null) }}><Pencil size={15} /> Change formula or units</button></div>}

      <details className="formulas__history">
        <summary className="field__label">Change history ({d.history.length})</summary>
        {d.history.length ? (
          <ul className="list">{d.history.map((h) => (
            <li key={h.id} className="list__item formulas__change">
              <span>
                <strong>{formulaLabel(h.before?.formulaCode ?? null)} → {formulaLabel(h.after?.formulaCode ?? null)}</strong>; units {h.after?.allowedUnits.join(', ') || 'any'}
                {h.reason && <span className="field__hint"> · “{h.reason}”</span>}
              </span>
              <span className="list__meta">{h.actor ?? 'Unknown user'} · {new Date(h.createdAt).toLocaleString()}</span>
            </li>
          ))}</ul>
        ) : <p className="field__hint">This activity uses its default formula and units.</p>}
      </details>
    </section>
  )
}

function EditActivity({ d, onCancel, onSaved }: { d: Detail; onCancel: () => void; onSaved: (msg: string) => void }) {
  const dialog = useDialog()
  const [formula, setFormula] = useState<string | null>(d.formulaCode)
  const [units, setUnits] = useState<string[]>(d.allowedUnits)
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const option = d.options.formulas.find((f) => f.code === formula) ?? d.options.formulas[d.options.formulas.length - 1]
  const offered = d.options.allUnits.filter((u) => option.units.includes(u.code))
  const dimensions = [...new Set(offered.map((u) => u.dimension))]
  const pickFormula = (code: string | null) => {
    setFormula(code)
    const allowed = d.options.formulas.find((f) => f.code === code)?.units ?? []
    setUnits((now) => now.filter((u) => allowed.includes(u)))
  }
  const toggle = (u: string) => setUnits((now) => (now.includes(u) ? now.filter((x) => x !== u) : [...now, u]))
  const restore = () => { setFormula(d.workbook.formulaCode); setUnits(d.workbook.allowedUnits); setReason('Restore the default') }

  const save = async () => {
    const ok = await dialog.confirm({
      title: 'Apply this change?',
      message: `${d.name} will use ${formulaLabel(formula)} with units ${units.join(', ') || 'any'}. It applies to every organisation from the next calculation (${d.usage.records} record${d.usage.records === 1 ? '' : 's'} use this activity). Results already calculated keep the formula they used.`,
      confirmLabel: 'Apply change',
    })
    if (!ok) return
    setBusy(true); setError(null)
    try {
      await apiPatch(`/api/platform/activity-types/${encodeURIComponent(d.code)}`, { formulaCode: formula, allowedUnits: units, reason })
      onSaved('Formula and units updated.')
    } catch (e) { setError((e as Error).message) } finally { setBusy(false) }
  }

  return (
    <div className="formulas__edit stack">
      <Notify kind="error" message={error} />
      <label className="field">
        <span className="field__label">Formula</span>
        <select className="input" value={formula ?? ''} onChange={(e) => pickFormula(e.target.value || null)}>
          {d.options.formulas.map((f) => <option key={f.code ?? 'none'} value={f.code ?? ''}>{f.code ? `${f.code}: ${f.title}` : f.title}</option>)}
        </select>
        <span className="field__hint">Only formulas that fit this activity are listed. The calculation steps inside each formula are fixed and tested.</span>
      </label>
      <fieldset className="formulas__units">
        <legend className="field__label">Units accepted</legend>
        {dimensions.map((dim) => (
          <div key={dim} className="formulas__dimension">
            <span className="field__hint">{dim}</span>
            <div className="formulas__checks">
              {offered.filter((u) => u.dimension === dim).map((u) => {
                const lock = units.includes(u.code) ? d.options.locked[u.code] : undefined
                return (
                  <label key={u.code} className="formulas__check" title={lock ?? u.name}>
                    <input type="checkbox" checked={units.includes(u.code)} disabled={!!lock} onChange={() => toggle(u.code)} />
                    <span>{u.code}</span>
                    {lock && <span className="field__hint">({lock})</span>}
                  </label>
                )
              })}
            </div>
          </div>
        ))}
      </fieldset>
      <label className="field">
        <span className="field__label">Reason for the change</span>
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Client's generators are vehicle-mounted" />
      </label>
      <div className="actions">
        <button type="button" className="button" disabled={busy || reason.trim().length < 5} onClick={() => void save()}>Save change</button>
        {d.changed && <button type="button" className="button button--ghost" onClick={restore}><RotateCcw size={15} /> Restore default</button>}
        <button type="button" className="button button--ghost" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
