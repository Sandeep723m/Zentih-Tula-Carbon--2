import { humanize } from './format'

export const API_URL = import.meta.env.VITE_API_URL ?? ''

// Called when the server says the session has ended, so the app can return to sign-in.
let unauthorized: (() => void) | null = null
export const onUnauthorized = (handler: (() => void) | null) => { unauthorized = handler }

export class ApiError extends Error {
  status: number
  clashId?: string
  constructor(status: number, message: string, extra?: { clashId?: string }) {
    super(message)
    this.status = status
    this.clashId = extra?.clashId
  }
}

export async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method,
      credentials: 'include', // session lives in an httpOnly cookie
      headers: body === undefined ? undefined : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, 'Unable to connect to Tula Carbon. Check your internet connection and try again.')
  }
  const text = await res.text()
  let data: { error?: string; clashId?: string; details?: Array<{ message?: string }> } | null = null
  let readable = true
  try { data = text ? JSON.parse(text) : null } catch { readable = false } // e.g. an HTML error page from a proxy
  if (res.status === 401 && !path.startsWith('/api/auth/')) unauthorized?.()
  if (res.ok && !readable) throw new ApiError(res.status, 'The server sent an unexpected response. Please try again in a moment.')
  if (!res.ok) throw new ApiError(res.status, humanize(data?.details?.[0]?.message ?? data?.error ?? `Request failed (${res.status})`), { clashId: data?.clashId })
  return data as T
}

export const apiGet = <T>(path: string) => request<T>('GET', path)
export const apiPost = <T>(path: string, body: unknown = {}) => request<T>('POST', path, body)
export const apiPatch = <T>(path: string, body: unknown) => request<T>('PATCH', path, body)
export const apiDelete = (path: string) => request<null>('DELETE', path)

// Sends a file as the raw request body; the server checks its name, type and size.
export async function apiUpload<T>(path: string, file: File): Promise<T> {
  let res: Response
  try {
    res = await fetch(`${API_URL}${path}`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(file.name) },
      body: file,
    })
  } catch {
    throw new ApiError(0, `Couldn't upload ${file.name}. Check your internet connection and try again.`)
  }
  const data = await res.json().catch(() => null)
  if (!res.ok) throw new ApiError(res.status, `${file.name}: ${data?.error ?? `upload failed (${res.status})`}`)
  return data as T
}

export const evidenceUrl = (id: string, inline = false) => `${API_URL}/api/evidence/${id}/download${inline ? '?inline=1' : ''}`
export const apiPut = <T>(path: string, body: unknown) => request<T>('PUT', path, body)
