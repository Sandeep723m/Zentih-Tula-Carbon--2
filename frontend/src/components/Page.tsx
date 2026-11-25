import type { ReactNode } from 'react'
import { Notify } from './Toast'

export const Header = ({ title, subtitle, action, badge }: { title: string; subtitle?: ReactNode; action?: ReactNode; badge?: ReactNode }) => (
  <header className="page__header page__header--row">
    <div>
      <div className="page__titleline"><h1 className="page__title">{title}</h1>{badge}</div>
      {subtitle && <p className="page__subtitle">{subtitle}</p>}
    </div>
    {action && <div className="page__actions">{action}</div>}
  </header>
)

// Error, loading and empty messages for a loaded section.
export const States = ({ error, loading, empty }: { error: string | null; loading: boolean; empty?: string | false }) => (
  <>
    <Notify kind="error" message={error} />
    {loading && !error && <Skeleton />}
    {empty && <p className="status">{empty}</p>}
  </>
)

// Shimmering placeholder lines while a section loads.
export const Skeleton = ({ rows = 3 }: { rows?: number }) => (
  <div className="skeleton" role="status" aria-label="Loading">
    {Array.from({ length: rows }, (_, i) => <span key={i} className="skeleton__line" />)}
  </div>
)
