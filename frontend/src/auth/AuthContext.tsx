import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ApiError, apiGet, apiPost, onUnauthorized } from '../services/apiClient'
import type { Me } from '../types/api'

interface AuthState {
  me: Me | null
  loading: boolean
  error: string | null
  expired: boolean // the session ended while the app was open
  refresh: () => Promise<void>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [expired, setExpired] = useState(false)

  const refresh = useCallback(async () => {
    try {
      const m = await apiGet<Me>('/api/auth/me')
      setMe(m)
      setError(null)
      if (m) setExpired(false)
    } catch (e) {
      setMe(null)
      // 401 just means "signed out"; anything else is a real problem to show.
      setError(e instanceof ApiError && e.status === 401 ? null : (e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [])

  const logout = useCallback(async () => {
    try { await apiPost('/api/auth/logout') } finally { setMe(null); setExpired(false) } // signed out on screen even if the network call fails
  }, [])

  useEffect(() => { void refresh() }, [refresh])
  useEffect(() => {
    onUnauthorized(() => { setExpired(true); setMe(null) })
    return () => onUnauthorized(null)
  }, [])

  return <AuthContext.Provider value={{ me, loading, error, expired, refresh, logout }}>{children}</AuthContext.Provider>
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider')
  return ctx
}

// Where the user belongs right now, given how far through sign-in they are.
export function nextStep(me: Me | null): '/login' | '/verify' | '/change-password' | '/platform' | '/organizations' | '/' {
  if (!me) return '/login'
  if (!me.mfaVerified) return '/verify'
  if (me.user.mustChangePassword) return '/change-password'
  if (me.user.platformRole === 'SUPER_ADMIN') return '/platform' // platform admins never enter a tenant
  if (!me.organization) return '/organizations'
  return '/'
}
