import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import { Header, States } from '../components/Page'
import { Pager, type Page } from '../components/Pager'
import { Tabs } from '../components/Tabs'
import { useLoad } from '../hooks/useLoad'
import { apiPost } from '../services/apiClient'
import { day } from '../services/format'
import type { QueryStatus, ReportingPeriod, VerificationQuery } from '../types/api'
import { Notify } from '../components/Toast'

const STATUS: Record<QueryStatus, string> = { OPEN: 'Waiting for the organisation', ANSWERED: 'Answered, waiting for the verifier', CLOSED: 'Closed' }

// Verifiers raise queries on a period or a record; the organisation answers; the verifier closes them.
export default function QueriesPage() {
  const { me } = useAuth()
  const isVerifier = me?.permissions.includes('query.create') ?? false
  const [params, setParams] = useSearchParams()
  const id = params.get('id') ?? ''
  const status = params.get('status') ?? ''
  const page = params.get('page') ?? '1'
  const list = useLoad<Page<VerificationQuery>>(`/api/queries?page=${page}${status ? `&status=${status}` : ''}`)
  const periods = useLoad<ReportingPeriod[]>(isVerifier ? '/api/reporting-periods' : '')
  const [error, setError] = useState<string | null>(null)

  const [raising, setRaising] = useState(false)
  const [draft, setDraft] = useState({ reportingPeriodId: '', message: '' })
  const raise = async () => {
    setError(null)
    try {
      const period = periods.data!.find((p) => p.id === draft.reportingPeriodId)!
      const q = await apiPost<VerificationQuery>('/api/queries', { reportingPeriodId: period.id, subject: `${period.name}: ${draft.message.trim().slice(0, 80)}`, message: draft.message })
      setRaising(false); setDraft({ reportingPeriodId: '', message: '' }); list.reload(); setParams({ id: q.id })
    } catch (e) { setError((e as Error).message) }
  }

  return (
    <>
      <Header
        title="Verification Queries"
        subtitle={isVerifier ? 'Your questions to the organisation and their answers.' : 'Questions from your verifiers.'}
        action={isVerifier && !raising && <button className="button" onClick={() => setRaising(true)}>Raise a query on a period</button>}
      />
      {raising && (
        <form className="card card--spaced" onSubmit={(e) => { e.preventDefault(); void raise() }}>
          <p className="field__hint">To ask about one record, open it and use "Raise a verification query".</p>
          <label className="field">
            <span className="field__label">Reporting period</span>
            <select className="input" required value={draft.reportingPeriodId} onChange={(e) => setDraft((d) => ({ ...d, reportingPeriodId: e.target.value }))}>
              <option value="">Select…</option>
              {periods.data?.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Your question</span>
            <textarea className="input" rows={3} required minLength={3} maxLength={5000} value={draft.message} onChange={(e) => setDraft((d) => ({ ...d, message: e.target.value }))} />
          </label>
          <div className="actions">
            <button className="button" type="submit">Send query</button>
            <button className="button button--ghost" type="button" onClick={() => setRaising(false)}>Cancel</button>
          </div>
        </form>
      )}
      <Notify kind="error" message={error} />
      <Tabs label="Query status" active={status} onChange={(k) => setParams(k ? { status: k } : {})} tabs={[
        { key: '', label: 'All' },
        { key: 'OPEN', label: isVerifier ? 'Waiting for the organisation' : 'To answer' },
        { key: 'ANSWERED', label: isVerifier ? 'To review' : 'Answered' },
        { key: 'CLOSED', label: 'Closed' },
      ]} />
      <div className="grid-2">
        <section className="card">
          <States error={list.error} loading={!list.data} empty={list.data?.total === 0 && 'No queries.'} />
          <ul className="list">
            {list.data?.rows.map((q) => (
              <li key={q.id}>
                <button className={`list__item ${q.id === id ? 'is-selected' : ''}`} onClick={() => setParams({ ...(status ? { status } : {}), id: q.id })}>
                  <span className="list__title">{q.subject}</span>
                  <span className="list__meta">{q.reportingPeriod.name} · {STATUS[q.status]} · {q.raisedBy.name}, {day(q.updatedAt)}</span>
                </button>
              </li>
            ))}
          </ul>
          {list.data && <Pager data={list.data} onPage={(n) => setParams({ ...(status ? { status } : {}), page: String(n) })} />}
        </section>
        {id && <Thread id={id} isVerifier={isVerifier} onChange={list.reload} />}
      </div>
    </>
  )
}

function Thread({ id, isVerifier, onChange }: { id: string; isVerifier: boolean; onChange: () => void }) {
  const q = useLoad<VerificationQuery>(`/api/queries/${id}`)
  const dialog = useDialog()
  const [text, setText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try { await fn(); q.reload(); onChange() } catch (e) { setError((e as Error).message) }
  }
  if (!q.data) return <section className="card"><States error={q.error} loading /></section>
  const d = q.data
  return (
    <section className="card">
      <h2 className="card__title">{d.subject}</h2>
      <p className="field__hint">
        {d.reportingPeriod.name} · {STATUS[d.status]}
        {d.activityRecord && <> · <Link className="link" to={`/activities/${d.activityRecord.id}`}>{d.activityRecord.facility.name} · {d.activityRecord.emissionSource.name} ({day(d.activityRecord.startDate)} to {day(d.activityRecord.endDate)})</Link></>}
      </p>
      <ul className="thread">
        {d.messages?.map((m) => (
          <li key={m.id} className="thread__item">
            <div className="field__hint">{m.author.name} · {new Date(m.createdAt).toLocaleString()}</div>
            <div className="thread__body">{m.body}</div>
          </li>
        ))}
      </ul>
      <Notify kind="error" message={error} />
      {d.status !== 'CLOSED' && (
        <form onSubmit={(e) => { e.preventDefault(); void act(async () => { await apiPost(`/api/queries/${id}/messages`, { body: text }); setText('') }) }}>
          <label className="field">
            <span className="field__label">{isVerifier ? 'Follow-up' : 'Answer'}</span>
            <textarea className="input" rows={3} maxLength={5000} value={text} onChange={(e) => setText(e.target.value)} required minLength={3} />
          </label>
          <div className="actions">
            <button className="button" type="submit">{isVerifier ? 'Send follow-up' : 'Send answer'}</button>
            {isVerifier && (
              <button type="button" className="button button--ghost" onClick={() => void (async () => {
                if (await dialog.confirm({ title: 'Close this query?', message: 'Closed queries cannot receive further messages.', confirmLabel: 'Close query' })) await act(() => apiPost(`/api/queries/${id}/close`))
              })()}>Close query</button>
            )}
          </div>
        </form>
      )}
    </section>
  )
}
