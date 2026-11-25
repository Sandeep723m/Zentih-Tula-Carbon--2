import { useEffect, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiPost } from '../services/apiClient'
import { Notify } from '../components/Toast'

export default function VerifyPage() {
  const { me, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const needsSetup = !me?.user.mfaEnabled
  const [setup, setSetup] = useState<{ secret: string; otpauthUrl: string } | null>(null)
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (!needsSetup) return
    apiPost<{ secret: string; otpauthUrl: string }>('/api/auth/mfa/setup')
      .then(setSetup)
      .catch((e: Error) => setError(e.message))
  }, [needsSetup])

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/auth/mfa/verify', { code })
      await refresh()
      navigate('/organizations')
    } catch (err) {
      setError((err as Error).message)
      setCode('')
      await refresh() // too many wrong codes ends the session → back to login
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="page page--narrow">
      <header className="page__header">
        <h1 className="page__title">Two-step verification</h1>
        <p className="page__subtitle">
          {needsSetup
            ? 'Add Tula Carbon to your authenticator app, then enter the 6-digit code it shows.'
            : 'Enter the 6-digit code from your authenticator app.'}
        </p>
      </header>
      <form className="card form" onSubmit={submit}>
        {needsSetup && setup && (
          <div className="field">
            <span className="field__label">Setup key (enter manually in your authenticator app)</span>
            <code className="code-box">{setup.secret.match(/.{1,4}/g)?.join(' ')}</code>
            <a className="link" href={setup.otpauthUrl}>Open in authenticator app on this device</a>
          </div>
        )}
        <label className="field">
          <span className="field__label">Verification code</span>
          <input
            className="input input--code"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="\d{6}"
            maxLength={6}
            required
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          />
        </label>
        <Notify kind="error" message={error} />
        <button className="button" disabled={busy || code.length !== 6}>{busy ? 'Verifying…' : 'Verify'}</button>
        <button type="button" className="button button--ghost" onClick={() => void logout()}>Back to sign in</button>
      </form>
    </main>
  )
}
