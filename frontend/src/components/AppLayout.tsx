import { Suspense, useEffect, useState } from 'react'
import { Skeleton } from './Page'
import { Link, Outlet, useLocation } from 'react-router-dom'
import { Building2, CalendarDays, ChevronDown } from 'lucide-react'
import { useAuth } from '../auth/AuthContext'
import { useLoad } from '../hooks/useLoad'
import { apiGet } from '../services/apiClient'
import { ROLE_LABELS, type ReportingPeriod } from '../types/api'
import { TENANT_NAV } from './nav'
import { Shell } from './Shell'

export default function AppLayout() {
  const { me, logout } = useAuth()
  const periods = useLoad<ReportingPeriod[]>(me?.permissions.includes('org.read') ? '/api/reporting-periods' : '')
  const { pathname } = useLocation()
  const [counts, setCounts] = useState<Record<string, number>>({})
  const can = (p: string) => !!me?.permissions.includes(p)
  const reviewer = can('activity.review'), queries = can('query.read'), verifier = me?.role === 'VERIFIER'
  // What is waiting for this person: records to review, and queries for their side to act on. Refreshed on each page change.
  useEffect(() => {
    let live = true
    const jobs: Array<Promise<[string, number]>> = []
    if (reviewer) jobs.push(apiGet<{ total: number }>('/api/activities?status=SUBMITTED').then((d) => ['/review', d.total]))
    if (queries) jobs.push(apiGet<{ total: number }>(`/api/queries?status=${verifier ? 'ANSWERED' : 'OPEN'}`).then((d) => ['/queries', d.total]))
    Promise.all(jobs).then((r) => { if (live) setCounts(Object.fromEntries(r)) }).catch(() => {})
    return () => { live = false }
  }, [pathname, reviewer, queries, verifier])
  if (!me?.organization || !me.role) return null

  const groups = TENANT_NAV.map((g) => ({ ...g, items: g.items.filter((i) => !i.permission || me.permissions.includes(i.permission)) })).filter((g) => g.items.length)
  const current = [...(periods.data ?? [])].sort((a, b) => b.startDate.localeCompare(a.startDate)).find((p) => p.status === 'OPEN') ?? periods.data?.[0]

  return (
    <Shell
      groups={groups}
      counts={counts}
      home="/"
      user={{ name: me.user.name, email: me.user.email, role: ROLE_LABELS[me.role] }}
      accountTo="/account"
      onSwitchOrg
      onLogout={() => void logout()}
      context={<>
        <Link className="pill" to="/organizations" title="Switch organisation"><Building2 size={15} /> <span className="pill__text">{me.organization.name}</span> <ChevronDown size={14} /></Link>
        {current && (
          <Link className="pill pill--hide-sm" to="/reporting-periods" title="Reporting periods">
            <CalendarDays size={15} /> {current.name}
            <span className={`badge ${current.status === 'OPEN' ? 'badge--approved' : 'badge--soft'}`}>{current.status === 'OPEN' ? 'Open' : 'Locked'}</span>
          </Link>
        )}
      </>}
    >
      {me.access === 'read' && <p className="banner" role="status">{me.accessReason}</p>}
      {verifier && periods.data?.length === 0 && (
        <p className="banner" role="status">No reporting period has been shared with you yet. Ask your Tenant Admin to give you access to the period you are verifying.</p>
      )}
      {me.access === 'none'
        ? <p className="banner banner--blocked" role="alert">{me.accessReason} <Link className="link" to="/organizations">Choose another organisation</Link></p>
        : <Suspense fallback={<Skeleton />}><Outlet /></Suspense>}
    </Shell>
  )
}
