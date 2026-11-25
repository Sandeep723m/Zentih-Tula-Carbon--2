import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import { Header, Skeleton, States } from '../components/Page'
import { Pager, type Page } from '../components/Pager'
import { Tabs } from '../components/Tabs'
import { Notify } from '../components/Toast'
import { useLoad } from '../hooks/useLoad'
import { apiPost } from '../services/apiClient'

interface Row { id: string; title: string; unit: string; status: 'OPEN' | 'RESOLVED'; resolvedValue: string | null; sources: number; spread: number; createdAt: string }
interface Item { id: string; kind: string; label: string; value: string; unit: string; activityRecordId: string | null; documentId: string | null; difference: number; differencePercent: number | null }
interface Detail extends Row {
  items: Item[]; reasons: string[]; resolution: string | null; resolvedAt: string | null
  history: Array<{ action: string; createdAt: string; actor: string | null; after: Record<string, unknown> | null }>
}
const KIND: Record<string, string> = { RECORD: 'Entered record', BILL: 'Bill', METER: 'Meter readings', OTHER_RECORD: 'Other record', MANUAL: 'Added by hand' }
const ACTION: Record<string, string> = { 'reconciliation.created': 'Started', 'reconciliation.source_added': 'Source added', 'reconciliation.resolved': 'Resolved', 'reconciliation.reopened': 'Reopened' }
const num = (n: number | string) => Number(n).toLocaleString(undefined, { maximumFractionDigits: 6 })

// Where sources about the same activity disagree, a person records the correct value and why. Records are never changed here.
export default function ReconciliationPage() {
  const [params, setParams] = useSearchParams()
  const status = params.get('status') ?? 'OPEN'
  const page = params.get('page') ?? '1'
  const selectedId = params.get('id') ?? ''
  const list = useLoad<Page<Row> & { counts: Partial<Record<Row['status'], number>> }>(`/api/reconciliations?page=${page}${status ? `&status=${status}` : ''}`)
  const set = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(patch)) if (v) next.set(k, v); else next.delete(k)
    setParams(next)
  }
  return (
    <>
      <Header title="Reconciliation" subtitle="Compare figures from different sources and agree the correct value." />
      <div className="documents">
        <section className="card">
          <Tabs small label="Status" active={status} onChange={(k) => set({ status: k, page: '', id: '' })} tabs={[
            { key: 'OPEN', label: 'Open', count: list.data?.counts.OPEN ?? 0, alert: !!list.data?.counts.OPEN },
            { key: 'RESOLVED', label: 'Resolved', count: list.data?.counts.RESOLVED ?? 0 },
            { key: '', label: 'All' },
          ]} />
          <States error={list.error} loading={!list.data} empty={list.data?.total === 0 && 'Nothing to reconcile here. Start one from a finding on Data Quality.'} />
          {!!list.data?.rows.length && (
            <ul className="list">
              {list.data.rows.map((r) => (
                <li key={r.id}>
                  <button type="button" className={`list__item doc-row ${r.id === selectedId ? 'is-selected' : ''}`} onClick={() => set({ id: r.id })}>
                    <span className="doc-row__main">
                      <span className="list__title doc-row__name">{r.title}</span>
                      <span className="list__meta">{r.sources} source{r.sources === 1 ? "" : "s"} · differ by up to {num(r.spread)} {r.unit}</span>
                    </span>
                    <span className={`badge ${r.status === 'RESOLVED' ? 'badge--success' : 'badge--warning'}`}>{r.status === 'RESOLVED' ? 'Resolved' : 'Open'}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          {list.data && <Pager data={list.data} onPage={(n) => set({ page: String(n) })} />}
        </section>
        {selectedId
          ? <ReconciliationDetail key={selectedId} id={selectedId} onChanged={list.reload} />
          : <section className="card empty-state"><p>Select a reconciliation to compare its sources.</p></section>}
      </div>
    </>
  )
}

function ReconciliationDetail({ id, onChanged }: { id: string; onChanged: () => void }) {
  const { data: r, reload } = useLoad<Detail>(`/api/reconciliations/${id}`)
  const { me } = useAuth()
  const canResolve = me?.permissions.includes('reconcile.resolve') ?? false
  const dialog = useDialog()
  const [notice, setNotice] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [item, setItem] = useState({ label: '', value: '' })
  const [choice, setChoice] = useState({ value: '', explanation: '' })
  if (!r) return <section className="card"><Skeleton /></section>

  const act = async (run: () => Promise<unknown>, done: string) => {
    setError(null); setNotice(null)
    try { await run(); setNotice(done); reload(); onChanged(); return true } catch (e) { setError((e as Error).message); return false }
  }
  const addSource = async () => { if (await act(() => apiPost(`/api/reconciliations/${id}/items`, { ...item, unit: r.unit }), 'Source added.')) setItem({ label: '', value: '' }) }
  const resolve = async () => { if (await act(() => apiPost(`/api/reconciliations/${id}/resolve`, choice), 'Reconciliation resolved.')) setChoice({ value: '', explanation: '' }) }
  const reopen = async () => {
    if (await dialog.confirm({ title: 'Reopen this reconciliation?', message: 'The decision is kept in its history.', confirmLabel: 'Reopen' })) await act(() => apiPost(`/api/reconciliations/${id}/resolve?reopen=1`), 'Reopened.')
  }

  return (
    <section className="card">
      <Notify message={notice} />
      <Notify kind="error" message={error} />
      <div className="card__headline card__headline--top">
        <h2 className="card__title">{r.title}</h2>
        <span className={`badge ${r.status === 'RESOLVED' ? 'badge--success' : 'badge--warning'}`}>{r.status === 'RESOLVED' ? 'Resolved' : 'Open'}</span>
      </div>
      <div className="table-wrap">
        <table className="table">
          <thead><tr><th>Source</th><th className="num">Value</th><th className="num">Difference from first</th></tr></thead>
          <tbody>{r.items.map((i, n) => (
            <tr key={i.id}>
              <td><span className="badge badge--soft">{KIND[i.kind] ?? i.kind}</span> {i.label}
                {(i.activityRecordId || i.documentId) && <div className="field__hint">
                  {i.activityRecordId && <Link className="link" to={`/activities/${i.activityRecordId}`}>Open record</Link>}
                  {i.activityRecordId && i.documentId && ' · '}
                  {i.documentId && <Link className="link" to={`/documents?id=${i.documentId}`}>Open document</Link>}
                </div>}
              </td>
              <td className="num">{num(i.value)} {i.unit}</td>
              <td className="num">{n === 0 ? '—' : `${i.difference > 0 ? '+' : ''}${num(i.difference)}${i.differencePercent !== null ? ` (${i.differencePercent > 0 ? '+' : ''}${i.differencePercent.toFixed(1)}%)` : ''}`}</td>
            </tr>
          ))}</tbody>
        </table>
      </div>
      <div className="callout"><span className="callout__text"><strong>Possible reasons.</strong> {r.reasons.join(' ')}</span></div>

      {r.status === 'RESOLVED' ? (
        <div className="stack stack--sm">
          <p><strong>Correct value: {num(r.resolvedValue ?? 0)} {r.unit}.</strong> {r.resolution}</p>
          <p className="field__hint">If a record needs changing, correct it through the normal edit and review steps.</p>
          {canResolve && <div className="actions"><button type="button" className="button button--ghost" onClick={() => void reopen()}>Reopen</button></div>}
        </div>
      ) : (
        <>
          <div className="grid-cols">
            <label className="field"><span className="field__label">Another source</span><input className="input" placeholder="e.g. ERP export, generator log" value={item.label} onChange={(e) => setItem({ ...item, label: e.target.value })} /></label>
            <label className="field"><span className="field__label">Value ({r.unit})</span><input className="input" inputMode="decimal" value={item.value} onChange={(e) => setItem({ ...item, value: e.target.value })} /></label>
          </div>
          <div className="actions"><button type="button" className="button button--ghost" disabled={!item.label || !item.value} onClick={() => void addSource()}>Add source</button></div>
          {canResolve && (
            <>
              <div className="grid-cols">
                <label className="field"><span className="field__label">Correct value ({r.unit})</span><input className="input" inputMode="decimal" value={choice.value} onChange={(e) => setChoice({ ...choice, value: e.target.value })} /></label>
                <label className="field"><span className="field__label">Why this value</span><input className="input" value={choice.explanation} onChange={(e) => setChoice({ ...choice, explanation: e.target.value })} /></label>
              </div>
              <div className="actions"><button type="button" className="button" disabled={!choice.value || !choice.explanation} onClick={() => void resolve()}>Record decision</button></div>
            </>
          )}
        </>
      )}

      <details className="doc-history">
        <summary className="field__label">History ({r.history.length})</summary>
        <ul className="list">{r.history.map((h, i) => <li key={i} className="list__item"><span>{ACTION[h.action] ?? h.action}{h.actor && ` by ${h.actor}`}</span><span className="list__meta">{new Date(h.createdAt).toLocaleString()}</span></li>)}</ul>
      </details>
    </section>
  )
}
