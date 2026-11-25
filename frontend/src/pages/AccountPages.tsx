import { useState, type FormEvent } from 'react'
import { useAuth } from '../auth/AuthContext'
import { apiPost } from '../services/apiClient'
import { Notify } from '../components/Toast'

const MIN = 10 // mirrors PASSWORD_MIN on the server

// `forced`: first change after a one-time password; the current password was just entered at sign-in.
function ChangePasswordForm({ onDone, forced = false }: { onDone: () => void | Promise<void>; forced?: boolean }) {
  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const problem = !next ? null
    : next.length < MIN ? `Use at least ${MIN} characters`
    : !forced && next === current ? 'Choose a password different from the current one'
    : confirm && confirm !== next ? 'The two new passwords do not match'
    : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (problem || confirm !== next) return setError(problem ?? 'The two new passwords do not match')
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/auth/password', forced ? { newPassword: next } : { currentPassword: current, newPassword: next })
      setCurrent(''); setNext(''); setConfirm('')
      await onDone()
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="form" onSubmit={(e) => void submit(e)}>
      {!forced && (
        <label className="field">
          <span className="field__label">Current password</span>
          <input className="input" type="password" autoComplete="current-password" required value={current} onChange={(e) => setCurrent(e.target.value)} />
        </label>
      )}
      <label className="field">
        <span className="field__label">New password (at least {MIN} characters, not containing your email name)</span>
        <input className="input" type="password" autoComplete="new-password" required value={next} onChange={(e) => setNext(e.target.value)} />
      </label>
      <label className="field">
        <span className="field__label">Repeat new password</span>
        <input className="input" type="password" autoComplete="new-password" required value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </label>
      {(error || problem) && <p className="status status--error" role="alert">{error ?? problem}</p>}
      <button className="button" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Change password'}</button>
    </form>
  )
}

// Shown after sign-in while the account still has a bootstrap or one-time password.
export function ForcedPasswordChangePage() {
  const { me, refresh, logout } = useAuth()
  return (
    <main className="page page--narrow">
      <header className="page__header">
        <h1 className="page__title">Choose a new password</h1>
        <p className="page__subtitle">{me?.user.email} is using a temporary password. Set your own to continue.</p>
      </header>
      <section className="card">
        <ChangePasswordForm forced onDone={refresh} />
        <button className="button button--ghost" onClick={() => void logout()}>Sign out</button>
      </section>
    </main>
  )
}

export function AccountSettingsPage() {
  const { me } = useAuth()
  const [done, setDone] = useState(false)
  return (
    <>
      <header className="page__header">
        <h1 className="page__title">Account Settings</h1>
        <p className="page__subtitle">{me?.user.name} · {me?.user.email}</p>
      </header>
      <section className="card card--spaced">
        <h2 className="card__title">Two-step verification</h2>
        <p className="status">{me?.user.mfaEnabled ? 'Enabled with an authenticator app.' : 'Not set up.'}</p>
      </section>
      <section className="card">
        <h2 className="card__title">Change password</h2>
        <Notify message={done && 'Password changed. Other devices have been signed out.'} />
        <ChangePasswordForm onDone={() => setDone(true)} />
      </section>
    </>
  )
}
