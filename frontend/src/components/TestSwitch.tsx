import { useEffect, useState } from 'react'
import { apiGet, apiPost } from '../services/apiClient'

// Right-edge quick-switch for the Zenith Testing sandbox. Renders nothing unless the server has
// TEST_SWITCH=true (so it is absent on a normal live deploy). Clicking a role signs in as that
// sandbox account and reloads. Backend refuses anything but the four Zenith roles.
type Account = { id: string; label: string }

export function TestSwitch() {
  const [accounts, setAccounts] = useState<Account[]>([])
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    apiGet<{ enabled: boolean; accounts: Account[] }>('/api/auth/test-switch')
      .then((d) => setAccounts(d.enabled ? d.accounts : []))
      .catch(() => setAccounts([]))
  }, [])

  if (accounts.length === 0) return null

  const switchTo = async (id: string) => {
    setBusy(true)
    try {
      await apiPost('/api/auth/test-switch/login', { account: id })
      window.location.assign('/')
    } catch {
      setBusy(false)
    }
  }

  return (
    <div className={`test-switch ${open ? 'test-switch--open' : ''}`}>
      <button type="button" className="test-switch__dot" aria-label="Switch test role" onClick={() => setOpen((v) => !v)} />
      {open && (
        <div className="test-switch__panel">
          {accounts.map((a) => (
            <button key={a.id} type="button" className="test-switch__role" disabled={busy} onClick={() => void switchTo(a.id)}>{a.label}</button>
          ))}
        </div>
      )}
    </div>
  )
}
