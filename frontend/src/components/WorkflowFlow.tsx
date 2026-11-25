import { Link } from 'react-router-dom'
import { BadgeCheck, Calculator, ClipboardCheck, FilePen, FileText, Lock, Settings2, TriangleAlert, type LucideIcon } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { useLoad } from '../hooks/useLoad'
import type { ActivitySummary, Attention, EmissionSource, Facility, ReportingPeriod } from '../types/api'

type State = 'done' | 'current' | 'todo'
interface Step { key: string; icon: LucideIcon; title: string; who: string; detail: string; state: State; to: string; action: string }

const STATE_LABEL: Record<State, string> = { done: 'Done', current: 'Do this next', todo: 'Not yet' }

// The whole reporting cycle as one flow, from setup to the final report, worked out from live counts.
// The first step that is not done is "Do this next". Later steps that are not done show "Not yet".
export function WorkflowFlow({ summary }: { summary: ActivitySummary }) {
  const { me } = useAuth()
  const can = (p: string) => !!me?.permissions.includes(p)
  const periods = useLoad<ReportingPeriod[]>('/api/reporting-periods')
  const facilities = useLoad<Facility[]>('/api/facilities')
  const sources = useLoad<EmissionSource[]>('/api/emission-sources')
  const attention = useLoad<Attention>(can('period.lock') ? '/api/attention' : '')
  if (!periods.data || !facilities.data || !sources.data) return null

  const period = [...periods.data].sort((a, b) => b.startDate.localeCompare(a.startDate)).find((p) => p.status === 'OPEN') ?? periods.data[0]
  const a = attention.data?.periods.find((x) => x.period.id === period?.id)
  const locked = period?.status === 'LOCKED'
  const stale = !!a?.open.some((i) => i.key === 'run')
  const missing = [!facilities.data.length && 'a facility', !periods.data.length && 'a reporting period', !sources.data.length && 'an emission source'].filter(Boolean) as string[]
  const inProgress = summary.draft + summary.returned

  const done = {
    setup: missing.length === 0,
    entry: summary.total > 0 && inProgress === 0,
    review: summary.approved > 0 && summary.submitted === 0,
    calc: locked || (!!a?.run && !stale),
    confirm: locked || (!!a?.run && !stale && a.counts.unconfirmed === 0 && a.counts.blocked === 0),
    lock: locked,
    report: locked,
  }
  const raw: Array<Omit<Step, 'state'> & { ok: boolean }> = [
    { key: 'setup', icon: Settings2, title: 'Set up', who: 'Tenant Admin', ok: done.setup,
      detail: missing.length ? `Add ${missing.length > 1 ? `${missing.slice(0, -1).join(', ')} and ${missing.at(-1)}` : missing[0]}.` : `${facilities.data.length} facilities, ${sources.data.length} emission sources`,
      to: !facilities.data.length ? '/facilities' : !periods.data.length ? '/reporting-periods' : '/emission-sources', action: 'Open setup' },
    { key: 'entry', icon: FilePen, title: 'Enter data', who: 'Data Entry', ok: done.entry,
      detail: summary.total === 0 ? 'Add bills, meter readings and fuel logs.' : inProgress ? `${summary.draft} draft, ${summary.returned} returned to fix` : `${summary.total} records entered`,
      to: inProgress ? `/activities?status=${summary.returned ? 'RETURNED' : 'DRAFT'}` : '/activities/new', action: inProgress ? 'Continue' : 'Add data' },
    { key: 'review', icon: ClipboardCheck, title: 'Review', who: 'Reviewer', ok: done.review,
      detail: summary.submitted ? `${summary.submitted} waiting for approval` : `${summary.approved} approved`,
      to: can('activity.review') ? '/review' : '/activities?status=SUBMITTED', action: 'Open review queue' },
    { key: 'calc', icon: Calculator, title: 'Calculate', who: 'Reviewer or Admin', ok: done.calc,
      detail: !a ? 'Turns approved data into emissions.' : stale ? 'Data changed since the last run. Run again.' : a.run ? `Last run ${new Date(a.run.createdAt).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}` : 'Not run yet',
      to: `/calculations${period ? `?period=${period.id}` : ''}`, action: 'Open calculations' },
    { key: 'confirm', icon: TriangleAlert, title: 'Confirm warnings', who: 'Reviewer or Admin', ok: done.confirm,
      detail: !a ? 'Check estimates and unusual values.' : a.counts.blocked ? `${a.counts.blocked} blocked, fix the record` : a.counts.unconfirmed ? `${a.counts.unconfirmed} to confirm` : 'Nothing to confirm',
      to: `/calculations${period ? `?period=${period.id}` : ''}`, action: 'Review warnings' },
    { key: 'lock', icon: Lock, title: 'Lock period', who: 'Tenant Admin', ok: done.lock,
      detail: locked ? `${period!.name} is final` : 'Freezes the figures for the year.',
      to: '/period-close', action: 'Open period close' },
    { key: 'report', icon: FileText, title: 'Report', who: 'Everyone, verifiers read-only', ok: done.report,
      detail: locked ? 'Final report ready' : a?.run ? 'Provisional report available' : 'Available after the first calculation',
      to: `/reports${period ? `?period=${period.id}` : ''}`, action: 'Open reports' },
  ]
  const first = raw.findIndex((s) => !s.ok)
  const steps: Step[] = raw.map(({ ok, ...s }, i) => ({ ...s, state: ok ? 'done' : i === first ? 'current' : 'todo' }))
  const doneCount = steps.filter((s) => s.state === 'done').length
  const progressPct = Math.round((doneCount / steps.length) * 100)

  return (
    <section className="card card--spaced flow" aria-label="Reporting workflow">
      <div className="flow__head">
        <div>
          <h2 className="card__title">Your reporting journey</h2>
          {period && <p className="flow__period">{period.name} · {doneCount} of {steps.length} steps done</p>}
        </div>
        {first >= 0 ? <span className="badge badge--returned">{steps[first].title} is next</span> : <span className="badge badge--approved">All steps complete</span>}
      </div>
      <div className="flow__bar"><div className="flow__bar-fill" style={{ width: `${progressPct}%` }} /></div>
      <ol className="flow__steps" style={{ '--progress': `${progressPct}%` } as React.CSSProperties}>
        {steps.map((s, i) => (
          <li key={s.key} className={`flow__step flow__step--${s.state}`} aria-current={s.state === 'current' ? 'step' : undefined}>
            <div className="flow__icon">
              {s.state === 'done' ? <BadgeCheck size={20} /> : <s.icon size={20} />}
            </div>
            <div className="flow__body">
              <span className="flow__num">{i + 1}. {STATE_LABEL[s.state]}</span>
              <strong className="flow__title">{s.title}</strong>
              <span className="flow__detail">{s.detail}</span>
              <span className="flow__who">{s.who}</span>
              {s.state !== 'todo' && <Link className="link flow__link" to={s.to}>{s.action} →</Link>}
            </div>
          </li>
        ))}
      </ol>
    </section>
  )
}
