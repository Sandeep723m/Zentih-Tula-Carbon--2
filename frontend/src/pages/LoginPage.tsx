import { useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiPost } from '../services/apiClient'
import { Notify } from '../components/Toast'
import { TestSwitch } from '../components/TestSwitch'

export default function LoginPage() {
  const { refresh, expired } = useAuth()
  const navigate = useNavigate()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const submit = async (e: FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError(null)
    try {
      await apiPost('/api/auth/login', { email, password })
      await refresh()
      navigate('/verify')
    } catch (err) {
      setError((err as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <main className="page page--narrow">
      <header className="page__header">
        <h1 className="page__title">Welcome back</h1>
        <p className="page__subtitle">Sign in to your carbon accounting workspace</p>
      </header>
      {expired && <p className="status status--warn" role="status"><span>Your session has ended. Please sign in again.</span></p>}

      <form className="card form" onSubmit={(e) => void submit(e)}>
        <label className="field">
          <span className="field__label">Work email</span>
          <input className="input" type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
        <label className="field">
          <span className="field__label">Password</span>
          <input className="input" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} />
        </label>
        <Notify kind="error" message={error} />
        <button className="button" disabled={busy}>{busy ? 'Signing in…' : 'Sign in'}</button>
      </form>
      <TestSwitch />
    </main>
  )
}
