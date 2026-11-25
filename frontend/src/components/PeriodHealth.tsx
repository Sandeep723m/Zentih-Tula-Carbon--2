import { humanize } from '../services/format'
import { Link } from 'react-router-dom'
import type { PeriodAttention } from '../types/api'

// Where each open item is fixed (shared by Period Close, Calculations, Reports and the dashboard).
export const FIX: Record<string, { to: (p: string) => string; label: string }> = {
  drafts: { to: (p) => `/activities?status=DRAFT&reportingPeriodId=${p}`, label: 'Open drafts' },
  submitted: { to: () => '/review', label: 'Review queue' },
  returned: { to: (p) => `/activities?status=RETURNED&reportingPeriodId=${p}`, label: 'Open returned' },
  approved: { to: () => '/review', label: 'Review queue' },
  run: { to: (p) => `/calculations?period=${p}`, label: 'Run calculation' },
  blocked: { to: (p) => `/calculations?period=${p}&filter=status%3DBLOCKED`, label: 'See blocked' },
  warnings: { to: (p) => `/calculations?period=${p}&filter=attention%3Dtrue`, label: 'Confirm warnings' },
  notCalculable: { to: () => '/emission-sources', label: 'Emission sources' },
}

// One period at a glance: where its records are, and every open item with the place to fix it.
export function PeriodHealth({ a, compact = false }: { a: PeriodAttention; compact?: boolean }) {
  const c = a.counts
  const chips: Array<[string, number, boolean]> = [
    ['draft', c.draft, c.draft > 0], ['awaiting review', c.submitted, c.submitted > 0], ['returned', c.returned, c.returned > 0],
    ['approved', c.approved, false], ['blocked', c.blocked, c.blocked > 0], ['warnings to confirm', c.unconfirmed, c.unconfirmed > 0],
  ]
  const open = a.open.filter((i) => !compact || i.mandatory)
  return (
    <div className={`next next--stack ${open.some((i) => i.mandatory) ? 'next--problem' : ''}`}>
      <p className="next__title">
        <strong>{a.period.name}</strong>
        {chips.map(([label, n, bad]) => <span key={label} className={`badge ${bad ? 'badge--error' : ''}`}>{n} {label}</span>)}
      </p>
      {open.length === 0
        ? <p className="field__hint">Everything is reviewed, calculated and confirmed. {a.canLock && <Link className="link" to={`/period-close?period=${a.period.id}`}>Lock the period</Link>}</p>
        : open.map((i) => (
          <div key={i.key} className="todo">
            <span><span className={i.mandatory ? 'mark--bad' : 'mark--muted'}>{i.mandatory ? '✗' : '!'}</span> {humanize(i.detail)}</span>
            {FIX[i.key] && <Link className="button button--small button--ghost" to={FIX[i.key].to(a.period.id)}>{FIX[i.key].label}</Link>}
          </div>
        ))}
    </div>
  )
}
