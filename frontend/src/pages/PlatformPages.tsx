import { Suspense, useCallback, useEffect, useState } from 'react'
import { Link, Outlet, useNavigate, useSearchParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import FieldsForm, { type Field } from '../components/FieldsForm'
import { Pager, type Page } from '../components/Pager'
import { apiGet, apiPatch, apiPost } from '../services/apiClient'
import { ROLE_LABELS, ROLES, type OrgAccess, type Role } from '../types/api'
import OrgPicker from '../components/OrgPicker'
import { Header, Skeleton, States } from '../components/Page'
import { useLoad } from '../hooks/useLoad'
import { ShieldCheck } from 'lucide-react'
import { PLATFORM_NAV } from '../components/nav'
import { Shell } from '../components/Shell'
import { day } from '../services/format'
import { Notify } from '../components/Toast'

// ---- Shared types and bits --------------------------------------------------------

export type SubStatus = 'TRIAL' | 'ACTIVE' | 'EXPIRED' | 'SUSPENDED' | 'CANCELLED'
export const SUB_STATUSES: SubStatus[] = ['TRIAL', 'ACTIVE', 'EXPIRED', 'SUSPENDED', 'CANCELLED']
export const SUB_LABELS: Record<SubStatus, string> = { TRIAL: 'Trial', ACTIVE: 'Active', EXPIRED: 'Expired', SUSPENDED: 'Suspended', CANCELLED: 'Cancelled' }

export interface Subscription { id: string; planName: string; status: SubStatus; effectiveStatus: SubStatus; startDate: string; endDate: string | null }
export interface PlatformOrg {
  id: string; name: string; legalName: string | null; country: string | null; industry: string | null; address: string | null
  status: 'ACTIVE' | 'SUSPENDED'; statusReason: string | null; createdAt: string
  subscription: Subscription | null; access: OrgAccess; reason: string | null
  _count?: { memberships: number; facilities: number }
}
export interface AuditRow {
  id: string; action: string; entityType: string; entityId: string | null; reason: string | null; createdAt: string
  before: unknown; after: unknown
  actor: { name: string; email: string } | null
  organization?: { id: string; name: string } | null
}

export const SubBadge = ({ s }: { s: Subscription | null }) =>
  !s ? <span className="badge">None</span>
    : <span className={`badge badge--sub-${s.effectiveStatus.toLowerCase()}`} title={s.effectiveStatus !== s.status ? `Recorded as ${SUB_LABELS[s.status]}; the end date has passed` : undefined}>{SUB_LABELS[s.effectiveStatus]}</span>
export const OrgBadge = ({ status }: { status: 'ACTIVE' | 'SUSPENDED' }) => <span className={`badge badge--org-${status.toLowerCase()}`}>{status === 'ACTIVE' ? 'Active' : 'Suspended'}</span>

export const subscriptionFields: Field[] = [
  { name: 'planName', label: 'Plan name', required: true },
  { name: 'status', label: 'Status', type: 'select', required: true, options: SUB_STATUSES.map((s) => ({ value: s, label: SUB_LABELS[s] })) },
  { name: 'startDate', label: 'Start date', type: 'date', required: true },
  { name: 'endDate', label: 'End date (blank = open-ended)', type: 'date' },
]



// ---- Layout -------------------------------------------------------------------------

export function PlatformLayout() {
  const { me, logout } = useAuth()
  return (
    <Shell
      groups={PLATFORM_NAV}
      home="/platform"
      user={{ name: me?.user.name ?? '', email: me?.user.email ?? '', role: 'Super Admin' }}
      accountTo="/platform/account"
      onLogout={() => void logout()}
      context={<span className="pill pill--static"><ShieldCheck size={15} /> Platform administration</span>}
    >
      <Suspense fallback={<Skeleton />}><Outlet /></Suspense>
    </Shell>
  )
}

// ---- Dashboard ----------------------------------------------------------------------

interface Summary {
  organizations: { total: number; active: number; suspended: number }
  users: { total: number; superAdmins: number }
  subscriptions: { byStatus: Record<SubStatus, number>; active: number; inactive: number }
}

const Stat = ({ value, label, to }: { value: number; label: string; to: string }) => (
  <Link className="stat" to={to}><span className="stat__value">{value}</span><span className="stat__label">{label}</span></Link>
)

// What the app checks about its own set-up, then what only the hosting account can confirm.
function Readiness() {
  const { data } = useLoad<{ checks: Array<{ key: string; ok: boolean; label: string; fix: string }> }>('/api/platform/readiness')
  if (!data) return null
  const open = data.checks.filter((c) => !c.ok).length
  return (
    <section className="card">
      <h2 className="card__title">Production readiness</h2>
      <p className="field__hint">{open ? `${open} of ${data.checks.length} checks need action before customers use the platform.` : 'All checks the platform can run on itself are passing.'}</p>
      <ul className="checklist">
        {data.checks.map((c) => (
          <li key={c.key} className={`checklist__item ${c.ok ? 'checklist__item--ok' : 'checklist__item--bad'}`}>
            <span aria-hidden className="checklist__mark">{c.ok ? '✓' : '✗'}</span>
            <span className="checklist__body"><strong>{c.label}</strong>{!c.ok && <div className="field__hint">{c.fix}</div>}</span>
          </li>
        ))}
        {OUTSIDE_CHECKS.map(([label, fix]) => (
          <li key={label} className="checklist__item checklist__item--advice">
            <span aria-hidden className="checklist__mark">!</span>
            <span className="checklist__body"><strong>{label}</strong><div className="field__hint">{fix}</div></span>
          </li>
        ))}
      </ul>
    </section>
  )
}
const OUTSIDE_CHECKS: Array<[string, string]> = [
  ['Daily backups, checked in the hosting account', 'In cPanel, back up the database and the document storage folder every day, and restore one copy to confirm it works.'],
  ['Uptime monitoring, checked outside the platform', 'Point an uptime monitor at /api/health. It answers 200 when the platform and its database are working, 503 otherwise.'],
  ['AI spending limit, checked with the AI provider', 'Set a monthly spending limit in the AI provider account.'],
]

export function PlatformDashboardPage() {
  const { data, error } = useLoad<Summary>('/api/platform/summary')
  return (
    <>
      <Header title="Platform Dashboard" subtitle="All customer organisations on Tula Carbon." action={<Link className="button" to="/platform/organizations?new=1">New organisation</Link>} />
      <States error={error} loading={!data} />
      {data && (
        <>
          <div className="stats">
            <Stat value={data.organizations.total} label="Customer organisations" to="/platform/organizations" />
            <Stat value={data.organizations.active} label="Active organisations" to="/platform/organizations?status=ACTIVE" />
            <Stat value={data.organizations.suspended} label="Suspended organisations" to="/platform/organizations?status=SUSPENDED" />
            <Stat value={data.users.total} label="Registered users" to="/platform/users" />
            <Stat value={data.subscriptions.active} label="Active or trial subscriptions" to="/platform/subscriptions" />
            <Stat value={data.subscriptions.inactive} label="Expired, suspended or cancelled" to="/platform/subscriptions" />
          </div>
          <section className="card">
            <h2 className="card__title">Subscriptions by status</h2>
            <div className="table-wrap">
              <table className="table">
                <thead><tr>{SUB_STATUSES.map((s) => <th key={s} className="num">{SUB_LABELS[s]}</th>)}</tr></thead>
                <tbody><tr>{SUB_STATUSES.map((s) => (
                  <td key={s} className="num"><Link className="link" to={`/platform/organizations?subscription=${s}`}>{data.subscriptions.byStatus[s]}</Link></td>
                ))}</tr></tbody>
              </table>
            </div>
            <p className="field__hint">Trial and Active subscriptions past their end date are counted as Expired.</p>
          </section>
          <Readiness />
        </>
      )}
    </>
  )
}

// ---- Organisations --------------------------------------------------------------------

const createFields: Field[] = [
  { name: 'name', label: 'Organisation name', required: true },
  { name: 'legalName', label: 'Legal name' },
  { name: 'country', label: 'Country' },
  { name: 'industry', label: 'Industry' },
  { name: 'adminName', label: 'First Tenant Admin — full name', required: true },
  { name: 'adminEmail', label: 'First Tenant Admin — email', required: true },
  ...subscriptionFields,
]

export function PlatformOrganizationsPage() {
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const query = new URLSearchParams([...params].filter(([k]) => k !== 'new')).toString()
  const { data, error, reload } = useLoad<Page<PlatformOrg>>(`/api/platform/organizations${query ? `?${query}` : ''}`)
  const [q, setQ] = useState(params.get('q') ?? '')
  const creating = params.get('new') === '1'
  const [created, setCreated] = useState<{ id: string; name: string; email: string; password: string | null } | null>(null)

  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    if (name !== 'page' && name !== 'new') next.delete('page') // new filter → back to page 1
    setParams(next)
  }

  const create = async (b: Record<string, unknown>) => {
    const body = {
      name: b.name, legalName: b.legalName, country: b.country, industry: b.industry,
      admin: { name: b.adminName, email: b.adminEmail },
      subscription: { planName: b.planName, status: b.status, startDate: b.startDate, endDate: b.endDate || null },
    }
    const r = await apiPost<{ organization: { id: string; name: string }; temporaryPassword: string | null }>('/api/platform/organizations', body)
    setCreated({ id: r.organization.id, name: r.organization.name, email: String(b.adminEmail), password: r.temporaryPassword })
    setParam('new', null)
    reload()
  }

  return (
    <>
      <Header title="Organisations" subtitle="Create and manage customer organisations." action={!creating && <button className="button" onClick={() => { setCreated(null); setParam('new', '1') }}>New organisation</button>} />

      {creating && (
        <section className="card card--spaced">
          <h2 className="card__title">New organisation</h2>
          <FieldsForm
            fields={createFields}
            initial={{ name: '', legalName: '', country: '', industry: '', adminName: '', adminEmail: '', planName: '', status: 'TRIAL', startDate: new Date().toISOString().slice(0, 10), endDate: '' }}
            submitLabel="Create organisation"
            onSubmit={create}
            onCancel={() => setParam('new', null)}
          />
        </section>
      )}

      {created && (
        <section className="card card--spaced" role="status">
          <p><strong>{created.name}</strong> created. <Link className="link" to={`/platform/organizations/${created.id}`}>Open it</Link></p>
          {created.password
            ? <><p>Give the Tenant Admin ({created.email}) this one-time password. It is shown only once and must be changed at first sign-in:</p><code className="code-box">{created.password}</code></>
            : <p>{created.email} already had an account and was added as Tenant Admin.</p>}
        </section>
      )}

      <form className="filters" onSubmit={(e) => { e.preventDefault(); setParam('q', q.trim() || null) }}>
        <input className="input" type="search" placeholder="Search name or legal name" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="button button--ghost" type="submit">Search</button>
        <select className="input" aria-label="Organisation status" value={params.get('status') ?? ''} onChange={(e) => setParam('status', e.target.value)}>
          <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="SUSPENDED">Suspended</option>
        </select>
        <select className="input" aria-label="Subscription" value={params.get('subscription') ?? ''} onChange={(e) => setParam('subscription', e.target.value)}>
          <option value="">All subscriptions</option>
          {SUB_STATUSES.map((s) => <option key={s} value={s}>{SUB_LABELS[s]}</option>)}
        </select>
      </form>

      <section className="card">
        <States error={error} loading={!data} empty={data?.total === 0 && (query ? 'No organisations match.' : 'No organisations yet. Create the first one.')} />
        {!!data?.rows.length && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Status</th><th>Subscription</th><th>Plan</th><th>Ends</th><th className="num">Members</th><th className="num">Facilities</th><th>Created</th></tr></thead>
              <tbody>
                {data.rows.map((o) => (
                  <tr key={o.id} className="table__row-link" onClick={() => navigate(`/platform/organizations/${o.id}`)}>
                    <td><Link className="link" to={`/platform/organizations/${o.id}`}>{o.name}</Link></td>
                    <td><OrgBadge status={o.status} /></td>
                    <td><SubBadge s={o.subscription} /></td>
                    <td>{o.subscription?.planName ?? '—'}</td>
                    <td>{day(o.subscription?.endDate ?? null)}</td>
                    <td className="num">{o._count?.memberships}</td>
                    <td className="num">{o._count?.facilities}</td>
                    <td>{day(o.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager data={data} onPage={(p) => setParam('page', String(p))} />}
      </section>
    </>
  )
}

// ---- Subscriptions --------------------------------------------------------------------

export function PlatformSubscriptionsPage() {
  const [params, setParams] = useSearchParams()
  const { data, error } = useLoad<Page<PlatformOrg>>(`/api/platform/organizations${params.toString() ? `?${params}` : ''}`)
  const setParam = (name: string, value: string | null) => {
    const next = new URLSearchParams(params)
    if (value) next.set(name, value)
    else next.delete(name)
    if (name !== 'page') next.delete('page')
    setParams(next)
  }
  return (
    <>
      <Header title="Subscriptions" subtitle="Subscriptions of every organisation." />
      <div className="filters">
        <select className="input" aria-label="Subscription status" value={params.get('subscription') ?? ''} onChange={(e) => setParam('subscription', e.target.value)}>
          <option value="">All statuses</option>
          {SUB_STATUSES.map((s) => <option key={s} value={s}>{SUB_LABELS[s]}</option>)}
        </select>
      </div>
      <section className="card">
        <States error={error} loading={!data} empty={data?.total === 0 && 'No subscriptions match.'} />
        {!!data?.rows.length && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Organisation</th><th>Subscription</th><th>Plan</th><th>Start</th><th>End</th><th>Member access</th></tr></thead>
              <tbody>
                {data.rows.map((o) => (
                  <tr key={o.id}>
                    <td><Link className="link" to={`/platform/organizations/${o.id}`}>{o.name}</Link>{o.status === 'SUSPENDED' && ' (org suspended)'}</td>
                    <td><SubBadge s={o.subscription} /></td>
                    <td>{o.subscription?.planName ?? '—'}</td>
                    <td>{day(o.subscription?.startDate ?? null)}</td>
                    <td>{o.subscription ? (o.subscription.endDate ? day(o.subscription.endDate) : 'Open-ended') : '—'}</td>
                    <td>{{ full: 'Full', read: 'Read-only', none: 'Blocked' }[o.access]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {data && <Pager data={data} onPage={(p) => setParam('page', String(p))} />}
      </section>
    </>
  )
}

// ---- Users / administrators -----------------------------------------------------------

export interface PlatformUserRow {
  id: string; email: string; name: string; isActive: boolean; mfaEnabled: boolean; mustChangePassword: boolean; createdAt: string
  platformRole: 'SUPER_ADMIN' | null
  _count: { memberships: number }
  membership?: { id: string; role: Role } | null // present when the list is filtered by organisation
}

export function PlatformUsersPage() {
  const { me } = useAuth()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const admins = params.get('type') === 'SUPER_ADMIN'
  const orgId = params.get('organizationId')
  const org = orgId ? { id: orgId, name: params.get('orgName') ?? 'Selected organisation' } : null
  // Organisation users: one organisation at a time, or a name/email search across all of them.
  const showList = admins || !!orgId || !!params.get('q')
  const apiParams = new URLSearchParams([...params].filter(([k]) => k !== 'orgName'))
  if (!admins) apiParams.set('type', 'MEMBER')
  const { data, error, reload } = useLoad<Page<PlatformUserRow>>(showList ? `/api/platform/users?${apiParams}` : '')
  const [q, setQ] = useState(params.get('q') ?? '')
  const [adding, setAdding] = useState(false)
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)

  const update = (changes: Record<string, string | null>) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) {
      if (v) next.set(k, v)
      else next.delete(k)
    }
    if (!('page' in changes)) next.delete('page')
    setParams(next)
  }
  const tab = (superAdmins: boolean) => { setQ(''); setParams(superAdmins ? { type: 'SUPER_ADMIN' } : {}) }

  const changeRole = async (u: PlatformUserRow, role: string) => {
    setActionError(null)
    try { await apiPatch(`/api/platform/organizations/${orgId}/members/${u.membership!.id}`, { role }) } catch (e) { setActionError((e as Error).message) }
    reload()
  }

  return (
    <>
      <Header title="Users / Administrators" subtitle="Manage user accounts." action={admins && !adding && <button className="button" onClick={() => { setAdding(true); setCreated(null) }}>New Super Admin</button>} />
      <div className="tabs" role="tablist">
        <button role="tab" aria-selected={!admins} className={!admins ? 'tab tab--active' : 'tab'} onClick={() => tab(false)}>Organisation users</button>
        <button role="tab" aria-selected={admins} className={admins ? 'tab tab--active' : 'tab'} onClick={() => tab(true)}>Super Admins</button>
      </div>

      {adding && (
        <section className="card card--spaced">
          <h2 className="card__title">New Super Admin</h2>
          <FieldsForm
            fields={[{ name: 'name', label: 'Full name', required: true }, { name: 'email', label: 'Email', required: true }]}
            initial={{ name: '', email: '' }}
            submitLabel="Create"
            onSubmit={async (b) => {
              const r = await apiPost<{ user: { email: string }; temporaryPassword: string }>('/api/platform/users', b)
              setCreated({ email: r.user.email, password: r.temporaryPassword })
              setAdding(false)
              reload()
            }}
            onCancel={() => setAdding(false)}
          />
        </section>
      )}
      {created && (
        <section className="card card--spaced" role="status">
          <p>Super Admin <strong>{created.email}</strong> created. One-time password (shown once, must be changed at first sign-in):</p>
          <code className="code-box">{created.password}</code>
        </section>
      )}

      <form className="filters" onSubmit={(e) => { e.preventDefault(); update({ q: q.trim() || null }) }}>
        {!admins && <OrgPicker value={org} onChange={(o) => update({ organizationId: o?.id ?? null, orgName: o?.name ?? null })} />}
        <input className="input" type="search" placeholder={org ? `Search in ${org.name}` : admins ? 'Search name or email' : 'Or find a person in any organisation'} aria-label="Search users" value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="button button--ghost" type="submit">Search</button>
        <select className="input" aria-label="Account state" value={params.get('state') ?? ''} onChange={(e) => update({ state: e.target.value || null })}>
          <option value="">Any state</option><option value="ACTIVE">Active</option><option value="PENDING">Not signed in yet</option><option value="INACTIVE">Deactivated</option>
        </select>
      </form>

      <section className="card">
        {!showList ? (
          <p className="status">Choose an organisation to see its members and roles, or search for a person by name or email.</p>
        ) : (
          <>
            <Notify kind="error" message={actionError} />
            <States error={error} loading={!data} empty={data?.total === 0 && 'No users match.'} />
            {!!data?.rows.length && (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Name</th><th>Email</th><th>{org ? `Role in ${org.name}` : admins ? 'Type' : 'Organisations'}</th><th>Status</th></tr></thead>
                  <tbody>
                    {data.rows.map((u) => (
                      <tr key={u.id}>
                        <td><Link className="link" to={`/platform/users/${u.id}`}>{u.name}</Link>{u.id === me?.user.id && ' (you)'}</td>
                        <td>{u.email}</td>
                        <td>
                          {org && u.membership ? (
                            <select className="input" aria-label={`Role of ${u.name}`} value={u.membership.role} onChange={(e) => void changeRole(u, e.target.value)}>
                              {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                            </select>
                          ) : admins ? 'Super Admin' : (
                            <button type="button" className="link link--button" onClick={() => navigate(`/platform/users/${u.id}`)}>{u._count.memberships} — view roles</button>
                          )}
                        </td>
                        <td><UserState u={u} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {data && <Pager data={data} onPage={(p) => update({ page: String(p) })} />}
          </>
        )}
      </section>
    </>
  )
}

export const UserState = ({ u }: { u: Pick<PlatformUserRow, 'isActive' | 'mustChangePassword'> }) =>
  !u.isActive ? <span className="badge badge--sub-suspended">Deactivated</span>
    : u.mustChangePassword ? <span className="badge badge--sub-expired">Not signed in yet</span>
    : <span className="badge badge--sub-active">Active</span>

// ---- Audit trail -------------------------------------------------------------------------

export function AuditTable({ rows, showOrg }: { rows: AuditRow[]; showOrg?: boolean }) {
  return (
    <div className="table-wrap">
      <table className="table">
        <thead><tr><th>When</th>{showOrg && <th>Organisation</th>}<th>Action</th><th>By</th><th>Record</th><th>Reason</th></tr></thead>
        <tbody>
          {rows.map((a) => (
            <tr key={a.id}>
              <td>{new Date(a.createdAt).toLocaleString()}</td>
              {showOrg && <td>{a.organization ? <Link className="link" to={`/platform/organizations/${a.organization.id}`}>{a.organization.name}</Link> : 'Platform'}</td>}
              <td><code>{a.action}</code></td>
              <td>{a.actor ? a.actor.name : 'System'}</td>
              <td>{a.entityType}</td>
              <td>{a.reason ?? ''}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export function PlatformAuditPage() {
  const [params, setParams] = useSearchParams()
  const [rows, setRows] = useState<AuditRow[] | null>(null)
  const [cursor, setCursor] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [action, setAction] = useState(params.get('action') ?? '')
  const filters = params.toString()

  // Newest 50; "Older events" appends the next 50 using the server's cursor.
  const load = useCallback((before: string | null) => {
    const q = new URLSearchParams(filters)
    if (before) q.set('before', before)
    apiGet<{ rows: AuditRow[]; nextCursor: string | null }>(`/api/platform/audit?${q}`)
      .then((r) => { setRows((old) => (before && old ? [...old, ...r.rows] : r.rows)); setCursor(r.nextCursor); setError(null) })
      .catch((e: Error) => setError(e.message))
  }, [filters])
  useEffect(() => { setRows(null); load(null) }, [load])

  const setParam = (name: string, value: string | null) => {
    const n = new URLSearchParams(params)
    if (value) n.set(name, value)
    else n.delete(name)
    setParams(n)
  }

  return (
    <>
      <Header title="Audit Trail" subtitle="Every change made on the platform, newest first." />
      <form className="filters" onSubmit={(e) => { e.preventDefault(); setParam('action', action.trim() || null) }}>
        <input className="input" type="search" placeholder="Action contains… (e.g. suspended)" aria-label="Action" value={action} onChange={(e) => setAction(e.target.value)} />
        <button className="button button--ghost" type="submit">Filter</button>
        <label className="field--inline">
          <input type="checkbox" checked={params.get('platformOnly') === 'true'} onChange={(e) => setParam('platformOnly', e.target.checked ? 'true' : null)} />
          Platform events only
        </label>
      </form>
      <section className="card">
        <States error={error} loading={!rows} empty={rows?.length === 0 && 'No events match.'} />
        {!!rows?.length && <AuditTable rows={rows} showOrg />}
        {cursor && <div className="pager"><button className="button button--ghost button--small" onClick={() => load(cursor)}>Older events</button></div>}
      </section>
    </>
  )
}
