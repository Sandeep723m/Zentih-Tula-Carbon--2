import { useCallback, useEffect, useState } from 'react'
import { apiGet } from '../services/apiClient'

// GET a path and keep the result. An empty path loads nothing (for "select something first").
export function useLoad<T>(path: string) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = useCallback(() => {
    if (!path) return
    apiGet<T>(path).then((d) => { setData(d); setError(null) }).catch((e: Error) => setError(e.message))
  }, [path])
  useEffect(load, [load])
  return { data, error, reload: load }
}
