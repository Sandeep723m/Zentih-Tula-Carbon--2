import { env } from '../config/env.js'
import { AiError } from './types.js'

// One request to a provider. Keys travel only in headers, and provider error bodies are never passed on.
export async function callProvider(url: string, headers: Record<string, string>, body?: unknown): Promise<unknown> {
  let res: Response
  try {
    res = await fetch(url, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { ...headers, ...(body === undefined ? {} : { 'content-type': 'application/json' }) },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(env.AI_TIMEOUT_MS),
    })
  } catch (e) {
    const name = (e as Error).name
    if (name === 'TimeoutError' || name === 'AbortError') throw new AiError('TIMEOUT', 'The AI service did not respond in time.')
    throw new AiError('NETWORK', 'Could not reach the AI service.')
  }
  if (res.ok) return res.json().catch(() => { throw new AiError('BAD_RESPONSE', 'The AI service sent an unreadable response.') })
  const reason = await res.text().catch(() => '')
  if (res.status === 401 || res.status === 403 || (res.status === 400 && reason.includes('API_KEY_INVALID'))) throw new AiError('INVALID_KEY', 'The AI service rejected the API key.')
  if (res.status === 429) throw new AiError('QUOTA', 'The AI service quota or rate limit has been reached.')
  if (res.status === 404 || reason.includes('model_not_found')) throw new AiError('MODEL_NOT_FOUND', 'The configured AI model was not found.')
  if (res.status >= 500) throw new AiError('UNAVAILABLE', 'The AI service is temporarily unavailable.')
  throw new AiError('BAD_RESPONSE', `The AI service refused the request (${res.status}).`)
}
