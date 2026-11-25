import { useState } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import { Header, States } from '../components/Page'
import { FIX } from '../components/PeriodHealth'
import { useLoad } from '../hooks/useLoad'
import { apiPost } from '../services/apiClient'
import { day, humanize } from '../services/format'
import type { Checklist, ReportingPeriod } from '../types/api'
import { Notify } from '../components/Toast'

// Finalising a reporting period: what is still open, lock on the latest run, audited reopen.
export default function PeriodClosePage() {
  const { me } = useAuth()
  const canReopen = me?.permissions.includes('period.manage') ?? false
  const dialog = useDialog()
  const [params, setParams] = useSearchParams()
  const periodId = params.get('period') ?? ''
  const periods = useLoad<ReportingPeriod[]>('/api/reporting-periods')
  const check = useLoad<Checklist>(periodId ? `/api/reporting-periods/${periodId}/checklist` : '')
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)

  const act = async (fn: () => Promise<unknown>, message: string) => {
    setError(null); setNotice(null)
    try { await fn(); check.reload(); periods.reload(); setNotice(message) } catch (e) { setError((e as Error).message) }
  }
  const lock = async () => {
    if (!(await dialog.confirm({
      title: `Lock ${check.data!.period.name}?`,
      message: 'The latest calculation run becomes the final figures. Records, reviews, runs and confirmations are frozen until a Tenant Admin reopens the period.',
      confirmLabel: 'Lock period',
    }))) return
    await act(() => apiPost(`/api/reporting-periods/${periodId}/lock`), 'Period locked. Its report is now final.')
  }
  const reopen = async () => {
    const reason = await dialog.prompt({
      title: `Reopen ${check.data!.period.name}?`,
      message: 'Reports go back to provisional. The locked run and all history are kept.',
      input: { label: 'Reason (kept in the audit trail)', required: true, placeholder: 'e.g. Late March invoice received' },
      confirmLabel: 'Reopen period', danger: true,
    })
    if (reason !== null) await act(() => apiPost(`/api/reporting-periods/${periodId}/reopen`, { reason }), 'Period reopened.')
  }

  const c = check.data
  return (
    <>
      <Header title="Period Close" subtitle="Finalise a reporting period once everything is reviewed and calculated." />
      <section className="card card--spaced">
        <label className="field field--md">
          <span className="field__label">Reporting period</span>
          <select className="input" value={periodId} onChange={(e) => setParams(e.target.value ? { period: e.target.value } : {})}>
            <option value="">Select…</option>
            {periods.data?.map((p) => <option key={p.id} value={p.id}>{p.name}{p.status === 'LOCKED' ? ' (locked)' : ''}</option>)}
          </select>
        </label>
      </section>

      {periodId && (
        <section className="card card--spaced">
          <States error={check.error} loading={!c} />
          {c && (
            <>
              <h2 className="card__title">
                {c.period.name} · {c.period.status === 'LOCKED' ? <span className="badge badge--approved">Locked {day(c.period.lockedAt)}</span> : <span className="badge">Open</span>}
              </h2>
              <ul className="checklist">
                {c.items.map((i) => (
                  <li key={i.key} className={`checklist__item ${i.ok ? 'checklist__item--ok' : i.mandatory ? 'checklist__item--bad' : 'checklist__item--advice'}`}>
                    <span aria-hidden className="checklist__mark">{i.ok ? '✓' : i.mandatory ? '✗' : '!'}</span>
                    <span className="checklist__body"><strong>{i.label}</strong>{!i.mandatory && ' (advisory)'}<div className="field__hint">{i.ok ? "" : humanize(i.detail)}</div></span>
                    {!i.ok && FIX[i.key] && c.period.status === 'OPEN' && <Link className="button button--small button--ghost" to={FIX[i.key].to(periodId)}>{FIX[i.key].label}</Link>}
                  </li>
                ))}
              </ul>
              <p className="field__hint">
                Fix open items on the <Link className="link" to={`/activities?reportingPeriodId=${periodId}`}>activity records</Link>, the <Link className="link" to="/review">review queue</Link> and the <Link className="link" to={`/calculations?period=${periodId}`}>calculations</Link> pages. Approval does not resolve calculation warnings: each needs its own confirmation.
              </p>
              <Notify kind="error" message={error} />
              <Notify message={notice} />
              <div className="actions">
                {c.period.status === 'OPEN' && <button className="button" disabled={!c.canLock} onClick={() => void lock()}>Lock period</button>}
                {c.period.status === 'LOCKED' && canReopen && <button className="button button--ghost button--danger" onClick={() => void reopen()}>Reopen…</button>}
                <Link className="button button--ghost" to={`/reports?period=${periodId}`}>Open report</Link>
              </div>
            </>
          )}
        </section>
      )}

      {!!c?.events.length && (
        <section className="card">
          <h2 className="card__title">Lock history</h2>
          <ul className="plain">
            {c.events.map((e) => (
              <li key={e.id}>{new Date(e.createdAt).toLocaleString()} · {e.actor.name} · <strong>{e.action === 'LOCKED' ? 'Locked' : 'Reopened'}</strong>{e.reason && <> · “{e.reason}”</>}</li>
            ))}
          </ul>
        </section>
      )}
    </>
  )
}
