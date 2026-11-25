import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useDialog } from '../components/Dialog'
import FieldsForm, { toValues } from '../components/FieldsForm'
import { apiPatch, apiPost, request } from '../services/apiClient'
import { ROLE_LABELS, ROLES, type Facility, type Member, type ReportingPeriod, type Role } from '../types/api'
import {
  AuditTable, OrgBadge, SUB_LABELS, SubBadge, subscriptionFields,
  type AuditRow, type PlatformOrg, type SubStatus,
} from './PlatformPages'
import { Header, States } from '../components/Page'
import { useLoad } from '../hooks/useLoad'
import { day, isoDay } from '../services/format'
import { Notify } from '../components/Toast'

interface Detail extends PlatformOrg {
  facilities: Facility[]
  reportingPeriods: ReportingPeriod[]
  memberships: Member[]
  subscriptionEvents: Array<{ id: string; planName: string; status: SubStatus; startDate: string; endDate: string | null; reason: string | null; createdAt: string }>
  _count: { activityRecords: number; emissionSources: number; evidence: number; memberships: number; facilities: number }
  audit: AuditRow[]
}

const profileFields = [
  { name: 'name', label: 'Organisation name', required: true },
  { name: 'legalName', label: 'Legal name' },
  { name: 'country', label: 'Country' },
  { name: 'industry', label: 'Industry' },
  { name: 'address', label: 'Registered address' },
]

export default function PlatformOrganizationPage() {
  const { id } = useParams()
  const { data: org, error, reload } = useLoad<Detail>(`/api/platform/organizations/${id}`)
  const [editing, setEditing] = useState<'profile' | 'subscription' | 'admin' | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const dialog = useDialog()

  const done = (message: string) => { setEditing(null); setNotice(message); setActionError(null); reload() }
  const run = async (fn: () => Promise<unknown>, message: string) => {
    setActionError(null)
    setNotice(null)
    try { await fn(); done(message) } catch (e) { setActionError((e as Error).message) }
  }

  if (!org) return <States error={error} loading />

  const toggleStatus = async () => {
    if (org.status === 'ACTIVE') {
      const reason = await dialog.prompt({
        title: `Suspend ${org.name}?`,
        message: 'Members lose access immediately. No data, evidence or audit history is deleted.',
        input: { label: 'Reason', required: true, placeholder: 'e.g. Unpaid invoice' },
        confirmLabel: 'Suspend organisation',
        danger: true,
      })
      if (reason === null) return
      void run(() => apiPost(`/api/platform/organizations/${org.id}/status`, { status: 'SUSPENDED', reason }), 'Organisation suspended.')
    } else if (await dialog.confirm({ title: `Reactivate ${org.name}?`, message: 'Members regain access straight away.', confirmLabel: 'Reactivate' })) {
      void run(() => apiPost(`/api/platform/organizations/${org.id}/status`, { status: 'ACTIVE' }), 'Organisation reactivated.')
    }
  }

  const sub = org.subscription
  const access = { full: 'Full access', read: 'Read-only', none: 'Blocked' }[org.access]

  return (
    <>
      <p className="cluster cluster--lg">
        <Link className="link" to="/platform/organizations">← All organisations</Link>
        <Link className="link" to={`/platform/organizations/${org.id}/boundary`}>⬡ Boundary Setup</Link>
      </p>
      <Header
        title={org.name}
        subtitle={`Created ${day(org.createdAt)} · ${org._count.activityRecords} activity records · ${org._count.evidence} evidence files`}
        action={<button className={`button ${org.status === 'ACTIVE' ? 'button--ghost button--danger' : ''}`} onClick={toggleStatus}>{org.status === 'ACTIVE' ? 'Suspend' : 'Reactivate'}</button>}
      />
      <Notify message={notice} />
      <Notify kind="error" message={actionError} />
      <p className="status">
        <OrgBadge status={org.status} /> · Subscription <SubBadge s={sub} /> · Members: <strong>{access}</strong>
        {org.reason && <> — {org.reason}</>}
        {org.status === 'SUSPENDED' && org.statusReason && <> (reason: {org.statusReason})</>}
      </p>

      <div className="grid-2">
        <section className="card">
          <h2 className="card__title">Profile</h2>
          {editing === 'profile' ? (
            <FieldsForm
              fields={profileFields}
              initial={toValues(profileFields, org as unknown as Record<string, unknown>)}
              submitLabel="Save"
              onSubmit={async (b) => { await apiPatch(`/api/platform/organizations/${org.id}`, b); done('Profile saved.') }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              <dl className="dl">
                <dt>Legal name</dt><dd>{org.legalName ?? '—'}</dd>
                <dt>Country</dt><dd>{org.country ?? '—'}</dd>
                <dt>Industry</dt><dd>{org.industry ?? '—'}</dd>
                <dt>Address</dt><dd>{org.address ?? '—'}</dd>
              </dl>
              <button className="button button--ghost button--small" onClick={() => setEditing('profile')}>Edit profile</button>
            </>
          )}
        </section>

        <section className="card">
          <h2 className="card__title">Subscription</h2>
          {editing === 'subscription' ? (
            <FieldsForm
              fields={[...subscriptionFields, { name: 'reason', label: 'Reason for change' }]}
              initial={{ planName: sub?.planName ?? '', status: sub?.status ?? 'TRIAL', startDate: sub ? isoDay(sub.startDate) : new Date().toISOString().slice(0, 10), endDate: sub?.endDate ? isoDay(sub.endDate) : '', reason: '' }}
              submitLabel="Save subscription"
              onSubmit={async (b) => { await request('PUT', `/api/platform/organizations/${org.id}/subscription`, { ...b, endDate: b.endDate || null, reason: b.reason || undefined }); done('Subscription updated.') }}
              onCancel={() => setEditing(null)}
            />
          ) : (
            <>
              {sub ? (
                <dl className="dl">
                  <dt>Plan</dt><dd>{sub.planName}</dd>
                  <dt>Status</dt><dd><SubBadge s={sub} />{sub.effectiveStatus !== sub.status && ` (stored as ${SUB_LABELS[sub.status]}, end date passed)`}</dd>
                  <dt>Start</dt><dd>{day(sub.startDate)}</dd>
                  <dt>End</dt><dd>{sub.endDate ? day(sub.endDate) : 'Open-ended'}</dd>
                </dl>
              ) : <p className="status">No subscription.</p>}
              <button className="button button--ghost button--small" onClick={() => setEditing('subscription')}>Change plan or status</button>
            </>
          )}
        </section>
      </div>

      <section className="card card--spaced">
        <Header title="Members" subtitle="Manage who has access and what they can do." action={editing !== 'admin' && <button className="button button--small" onClick={() => setEditing('admin')}>Add member</button>} />
        {editing === 'admin' && (
          <div className="card--spaced">
            <p className="field__hint">A new email gets an account with a one-time password, shown once below. Someone who already has an account is simply added.</p>
            <FieldsForm
              fields={[
                { name: 'name', label: 'Full name', required: true },
                { name: 'email', label: 'Email', required: true },
                { name: 'role', label: 'Role', type: 'select', required: true, options: ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] })) },
              ]}
              initial={{ name: '', email: '', role: 'TENANT_ADMIN' }}
              submitLabel="Add member"
              onSubmit={async (b) => {
                const r = await apiPost<{ member: Member; temporaryPassword: string | null }>(`/api/platform/organizations/${org.id}/members`, b)
                const who = `${r.member.user.email} added as ${ROLE_LABELS[r.member.role]}.`
                done(r.temporaryPassword ? `${who} One-time password (shown once, changed at first sign-in): ${r.temporaryPassword}` : `${who} They already had an account and use their existing password.`)
              }}
              onCancel={() => setEditing(null)}
            />
          </div>
        )}
        {org.memberships.length === 0 ? <p className="status">No members.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name (open for password reset)</th><th>Email</th><th>Two-step</th><th>Role</th></tr></thead>
              <tbody>
                {org.memberships.map((m) => (
                  <tr key={m.id}>
                    <td><Link className="link" to={`/platform/users/${m.user.id}`}>{m.user.name}</Link>{!m.user.isActive && ' (deactivated)'}</td>
                    <td>{m.user.email}</td>
                    <td>{m.user.mfaEnabled ? 'Set up' : 'Pending'}</td>
                    <td>
                      <select className="input" aria-label={`Role of ${m.user.name}`} value={m.role}
                        onChange={(e) => void run(() => apiPatch(`/api/platform/organizations/${org.id}/members/${m.id}`, { role: e.target.value as Role }), 'Role changed.')}>
                        {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="grid-2">
        <section className="card">
          <h2 className="card__title">Facilities ({org.facilities.length})</h2>
          {org.facilities.length === 0 ? <p className="status">None yet.</p> : (
            <ul className="plain">{org.facilities.map((f) => <li key={f.id}>{f.code} — {f.name}{!f.isActive && ' (inactive)'}</li>)}</ul>
          )}
          <Link className="button button--ghost button--small" to={`/platform/organizations/${org.id}/boundary`}>
            Open Boundary Setup
          </Link>
        </section>
        <section className="card">
          <h2 className="card__title">Reporting periods ({org.reportingPeriods.length})</h2>
          {org.reportingPeriods.length === 0 ? <p className="status">None yet.</p> : (
            <ul className="plain">{org.reportingPeriods.map((p) => <li key={p.id}>{p.name}: {day(p.startDate)} to {day(p.endDate)}{p.status === 'LOCKED' && ' (locked)'}</li>)}</ul>
          )}
        </section>
      </div>

      <section className="card card--spaced">
        <h2 className="card__title">Subscription history</h2>
        {org.subscriptionEvents.length === 0 ? <p className="status">No changes recorded.</p> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>When</th><th>Plan</th><th>Status</th><th>Start</th><th>End</th><th>Reason</th></tr></thead>
              <tbody>
                {org.subscriptionEvents.map((e) => (
                  <tr key={e.id}><td>{new Date(e.createdAt).toLocaleString()}</td><td>{e.planName}</td><td>{SUB_LABELS[e.status]}</td><td>{day(e.startDate)}</td><td>{e.endDate ? day(e.endDate) : 'Open-ended'}</td><td>{e.reason ?? ''}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="card">
        <h2 className="card__title">Audit history (latest 100)</h2>
        {org.audit.length === 0 ? <p className="status">No events.</p> : <AuditTable rows={org.audit} />}
      </section>
    </>
  )
}
