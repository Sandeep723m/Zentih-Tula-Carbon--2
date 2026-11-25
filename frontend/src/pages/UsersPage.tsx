import { useCallback, useEffect, useState } from 'react'
import { useAuth } from '../auth/AuthContext'
import { useDialog } from '../components/Dialog'
import FieldsForm from '../components/FieldsForm'
import { apiDelete, apiGet, apiPatch, apiPost } from '../services/apiClient'
import { ROLE_LABELS, ROLES, type Member, type ReportingPeriod, type Role, type VerifierGrant } from '../types/api'
import { useLoad } from '../hooks/useLoad'
import { Skeleton } from '../components/Page'
import { Notify } from '../components/Toast'

const roleOptions = ROLES.map((r) => ({ value: r, label: ROLE_LABELS[r] }))

export default function UsersPage() {
  const { me } = useAuth()
  const dialog = useDialog()
  const [members, setMembers] = useState<Member[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [invited, setInvited] = useState<{ email: string; password: string | null } | null>(null)

  const load = useCallback(() => {
    apiGet<Member[]>('/api/members').then(setMembers).catch((e: Error) => setError(e.message))
  }, [])
  useEffect(load, [load])

  // Errors (e.g. "must keep at least one Tenant Admin") are shown and the list reloaded.
  const act = async (fn: () => Promise<unknown>) => {
    setError(null)
    try { await fn() } catch (e) { setError((e as Error).message) }
    load()
  }

  const invite = async (body: Record<string, unknown>) => {
    const r = await apiPost<{ member: Member; temporaryPassword: string | null }>('/api/members', body)
    setInvited({ email: r.member.user.email, password: r.temporaryPassword })
    setInviting(false)
    load()
  }

  return (
    <>
      <header className="page__header page__header--row">
        <div>
          <h1 className="page__title">Users & Roles</h1>
          <p className="page__subtitle">Who can access this organisation, and what they may do.</p>
        </div>
        {!inviting && <button className="button" onClick={() => { setInviting(true); setInvited(null) }}>Invite user</button>}
      </header>

      {inviting && (
        <section className="card card--spaced">
          <h2 className="card__title">Invite user</h2>
          <FieldsForm
            fields={[
              { name: 'name', label: 'Full name', required: true },
              { name: 'email', label: 'Email', required: true },
              { name: 'role', label: 'Role', type: 'select', required: true, options: roleOptions },
            ]}
            initial={{ name: '', email: '', role: 'DATA_ENTRY' }}
            submitLabel="Invite"
            onSubmit={invite}
            onCancel={() => setInviting(false)}
          />
        </section>
      )}

      {invited && (
        <section className="card card--spaced" role="status">
          {invited.password ? (
            <>
              <p>One-time password for <strong>{invited.email}</strong>. Give it to them now; it is shown only once and any earlier one no longer works:</p>
              <code className="code-box">{invited.password}</code>
              <p className="status">They will set up two-step verification at first sign-in.</p>
            </>
          ) : (
            <p><strong>{invited.email}</strong> already had an account and has been added to this organisation.</p>
          )}
        </section>
      )}

      <section className="card">
        <Notify kind="error" message={error} />
        {!members && !error && <Skeleton />}
        {members && (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Name</th><th>Email</th><th>Sign-in</th><th>Role</th><th aria-label="Actions" /></tr></thead>
              <tbody>
                {members.map((m) => (
                  <tr key={m.id}>
                    <td>{m.user.name}{m.user.id === me?.user.id && ' (you)'}</td>
                    <td>{m.user.email}</td>
                    <td>{m.user.mustChangePassword ? 'Not signed in yet' : m.user.mfaEnabled ? 'Set up' : 'Pending'}</td>
                    <td>
                      <select
                        className="input"
                        aria-label={`Role of ${m.user.name}`}
                        value={m.role}
                        onChange={(e) => void act(() => apiPatch(`/api/members/${m.id}`, { role: e.target.value as Role }))}
                      >
                        {roleOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
                      </select>
                    </td>
                    <td className="table__actions">
                      {m.user.mustChangePassword && (
                        <button
                          className="button button--ghost button--small"
                          title="Lost the one-time password? Issue a new one; the old one stops working."
                          onClick={() => void act(async () => {
                            const r = await apiPost<{ temporaryPassword: string }>(`/api/members/${m.id}/reset-password`)
                            setInvited({ email: m.user.email, password: r.temporaryPassword })
                          })}
                        >
                          New one-time password
                        </button>
                      )}
                      <button
                        className="button button--ghost button--small button--danger"
                        onClick={async () => { if (await dialog.confirm({ title: `Remove ${m.user.name}?`, message: 'They lose access to this organisation immediately. Records they created are kept.', confirmLabel: 'Remove', danger: true })) void act(() => apiDelete(`/api/members/${m.id}`)) }}
                      >
                        Remove
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      {members?.some((m) => m.role === 'VERIFIER') && <VerifierAccess verifiers={members.filter((m) => m.role === 'VERIFIER')} />}
    </>
  )
}

// External verifiers see only the reporting periods ticked here, and in them only approved records.
function VerifierAccess({ verifiers }: { verifiers: Member[] }) {
  const grants = useLoad<VerifierGrant[]>('/api/verifier-grants')
  const periods = useLoad<ReportingPeriod[]>('/api/reporting-periods')
  const [error, setError] = useState<string | null>(null)
  const toggle = async (userId: string, reportingPeriodId: string, grant?: VerifierGrant) => {
    setError(null)
    try {
      if (grant) await apiDelete(`/api/verifier-grants/${grant.id}`)
      else await apiPost('/api/verifier-grants', { userId, reportingPeriodId })
    } catch (e) { setError((e as Error).message) }
    grants.reload()
  }
  return (
    <section className="card card--spaced">
      <h2 className="card__title">Verifier access</h2>
      <p className="field__hint">Verifiers see only the reporting periods ticked here, and in them only approved records, calculations, reports and evidence. Every change is audited.</p>
      <Notify kind="error" message={error} />
      {grants.data && periods.data && (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Verifier</th>{periods.data.map((p) => <th key={p.id}>{p.name}</th>)}</tr></thead>
            <tbody>
              {verifiers.map((v) => (
                <tr key={v.id}>
                  <td>{v.user.name}<div className="field__hint">{v.user.email}</div></td>
                  {periods.data!.map((p) => {
                    const g = grants.data!.find((x) => x.user.id === v.user.id && x.reportingPeriod.id === p.id)
                    return <td key={p.id}><input type="checkbox" aria-label={`${v.user.name}: ${p.name}`} checked={!!g} onChange={() => void toggle(v.user.id, p.id, g)} /></td>
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}
