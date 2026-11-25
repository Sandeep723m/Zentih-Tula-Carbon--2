import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import { apiPatch, apiPost } from '../services/apiClient'
import { ROLE_LABELS, ROLES, type Role } from '../types/api'
import { Header, States } from '../components/Page'
import { useLoad } from '../hooks/useLoad'
import { day } from '../services/format'
import { AuditTable, OrgBadge, UserState, type AuditRow, type PlatformUserRow } from './PlatformPages'
import { Notify } from '../components/Toast'

interface UserDetail extends PlatformUserRow {
  lockedUntil: string | null
  memberships: Array<{ id: string; role: Role; createdAt: string; organization: { id: string; name: string; status: 'ACTIVE' | 'SUSPENDED' } }>
  audit: AuditRow[]
}

export default function PlatformUserPage() {
  const { id } = useParams()
  const { me } = useAuth()
  const { data: u, error, reload } = useLoad<UserDetail>(`/api/platform/users/${id}`)
  const [notice, setNotice] = useState<string | null>(null)
  const [password, setPassword] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const dialog = useDialog()

  if (!u) return <States error={error} loading />
  const self = u.id === me?.user.id

  const run = async (question: Parameters<typeof dialog.confirm>[0], fn: () => Promise<unknown>, message: string) => {
    if (!(await dialog.confirm(question))) return
    setActionError(null); setNotice(null); setPassword(null)
    try { await fn(); setNotice(message); reload() } catch (e) { setActionError((e as Error).message) }
  }
  const reset = (resetMfa: boolean) => run(
    resetMfa
      ? { title: 'Reset password and two-step?', message: `For ${u.email}. Use this when they lost their phone. They are signed out everywhere.`, confirmLabel: 'Reset both', danger: true }
      : { title: 'Issue a new one-time password?', message: `For ${u.email}. The old password stops working and they are signed out everywhere.`, confirmLabel: 'Issue password' },
    async () => setPassword((await apiPost<{ temporaryPassword: string }>(`/api/platform/users/${u.id}/reset-password`, { resetMfa })).temporaryPassword),
    resetMfa ? 'Password and two-step verification reset.' : 'New one-time password issued.',
  )

  return (
    <>
      <p><Link className="link" to="/platform/users">← All users</Link></p>
      <Header title={u.name} subtitle={`${u.email} · ${u.platformRole ? 'Super Admin' : 'Organisation user'} · joined ${day(u.createdAt)}`} />
      <Notify message={notice} />
      {password && (
        <section className="card card--spaced" role="status">
          <p>Give {u.email} this one-time password. It is shown only once; they must change it at sign-in:</p>
          <code className="code-box">{password}</code>
        </section>
      )}
      <Notify kind="error" message={actionError} />

      <div className="grid-2">
        <section className="card">
          <h2 className="card__title">Account</h2>
          <dl className="dl">
            <dt>Status</dt><dd><UserState u={u} /></dd>
            <dt>Two-step</dt><dd>{u.mfaEnabled ? 'Set up' : 'Not set up yet'}</dd>
            <dt>Password</dt><dd>{u.mustChangePassword ? 'One-time password, not changed yet' : 'Set by the user'}</dd>
            {u.lockedUntil && new Date(u.lockedUntil) > new Date() && <><dt>Locked</dt><dd>Too many failed sign-ins, until {new Date(u.lockedUntil).toLocaleTimeString()}</dd></>}
          </dl>
          {self ? <p className="field__hint">Manage your own account in <Link className="link" to="/platform/account">Account Settings</Link>.</p> : (
            <div className="actions">
              <button className="button button--ghost button--small" onClick={() => void reset(false)}>New one-time password</button>
              <button className="button button--ghost button--small" onClick={() => void reset(true)}>Reset password + two-step</button>
              {u.isActive
                ? <button className="button button--ghost button--small button--danger" onClick={() => void run({ title: `Deactivate ${u.email}?`, message: 'They are signed out everywhere and cannot sign in. Their data is kept.', confirmLabel: 'Deactivate', danger: true }, () => apiPatch(`/api/platform/users/${u.id}`, { isActive: false }), 'Account deactivated.')}>Deactivate</button>
                : <button className="button button--ghost button--small" onClick={() => void run({ title: `Reactivate ${u.email}?`, confirmLabel: 'Reactivate' }, () => apiPatch(`/api/platform/users/${u.id}`, { isActive: true }), 'Account reactivated.')}>Reactivate</button>}
              {u.platformRole === 'SUPER_ADMIN' && (
                <button className="button button--ghost button--small" onClick={() => void run({ title: 'Revoke Super Admin?', message: `${u.email} loses access to the platform admin area.`, confirmLabel: 'Revoke', danger: true }, () => apiPatch(`/api/platform/users/${u.id}`, { platformRole: null }), 'Super Admin rights removed.')}>Revoke Super Admin</button>
              )}
            </div>
          )}
        </section>

        <section className="card">
          <h2 className="card__title">Organisations ({u.memberships.length})</h2>
          {u.platformRole ? <p className="status">Super Admins do not belong to organisations.</p>
            : u.memberships.length === 0 ? <p className="status">Not a member of any organisation.</p> : (
              <div className="table-wrap">
                <table className="table">
                  <thead><tr><th>Organisation</th><th>Role</th><th>Since</th></tr></thead>
                  <tbody>
                    {u.memberships.map((m) => (
                      <tr key={m.id}>
                        <td><Link className="link" to={`/platform/organizations/${m.organization.id}`}>{m.organization.name}</Link> {m.organization.status === 'SUSPENDED' && <OrgBadge status="SUSPENDED" />}</td>
                        <td>
                          <select className="input" aria-label={`Role in ${m.organization.name}`} value={m.role}
                            onChange={(e) => void run({ title: 'Change role?', message: `${u.name} becomes ${ROLE_LABELS[e.target.value as Role]} in ${m.organization.name}.`, confirmLabel: 'Change role' }, () => apiPatch(`/api/platform/organizations/${m.organization.id}/members/${m.id}`, { role: e.target.value }), 'Role changed.')}>
                            {ROLES.map((r) => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
                          </select>
                        </td>
                        <td>{day(m.createdAt)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          {!u.platformRole && <p className="field__hint">Roles are set per organisation.</p>}
        </section>
      </div>

      <section className="card">
        <h2 className="card__title">Activity (latest 50)</h2>
        {u.audit.length === 0 ? <p className="status">No events.</p> : <AuditTable rows={u.audit} showOrg />}
      </section>
    </>
  )
}
