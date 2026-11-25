import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../auth/AuthContext'
import { apiGet, apiPost } from '../services/apiClient'
import { ROLE_LABELS, type OrganizationOption } from '../types/api'
import { Skeleton } from '../components/Page'
import { Notify } from '../components/Toast'

export default function OrganizationsPage() {
  const { me, refresh, logout } = useAuth()
  const navigate = useNavigate()
  const [orgs, setOrgs] = useState<OrganizationOption[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    apiGet<OrganizationOption[]>('/api/auth/organizations')
      .then(setOrgs)
      .catch((e: Error) => setError(e.message))
  }, [])

  const choose = async (id: string) => {
    setError(null)
    try {
      await apiPost('/api/auth/organization', { organizationId: id })
      await refresh()
      navigate('/')
    } catch (e) {
      setError((e as Error).message)
    }
  }

  return (
    <main className="page page--narrow">
      <header className="page__header">
        <h1 className="page__title">Select an organisation</h1>
        <p className="page__subtitle">Signed in as {me?.user.email}</p>
      </header>
      <section className="card">
        <Notify kind="error" message={error} />
        {!orgs && !error && <Skeleton />}
        {orgs?.length === 0 && (
          <p className="status">You have not been added to any organisation yet. Ask your organisation's administrator to invite you.</p>
        )}
        <ul className="list">
          {orgs?.map((o) => (
            <li key={o.id}>
              <button className="list__item" onClick={() => void choose(o.id)} disabled={o.access === 'none'} title={o.reason ?? undefined}>
                <span className="list__title">{o.name}</span>
                <span className="list__meta">
                  {ROLE_LABELS[o.role]}{me?.organization?.id === o.id ? ' · current' : ''}
                  {o.access === 'none' && ' · unavailable'}{o.access === 'read' && ' · read-only'}
                </span>
              </button>
              {o.access !== 'full' && o.reason && <p className="field__hint">{o.reason}</p>}
            </li>
          ))}
        </ul>
        <button className="button button--ghost" onClick={() => void logout()}>Sign out</button>
      </section>
    </main>
  )
}
