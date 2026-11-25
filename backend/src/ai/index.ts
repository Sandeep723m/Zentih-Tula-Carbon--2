import { env } from '../config/env.js'
import { gemini } from './gemini.js'
import { openai } from './openai.js'
import { AiError, type AiProvider } from './types.js'

export { AiError } from './types.js'

// To add a provider, implement AiProvider and list it here; nothing else changes.
const PROVIDERS: Record<string, AiProvider> = { gemini, openai }

export function aiConfig(): { provider: AiProvider; model: string } {
  const provider = PROVIDERS[env.AI_PROVIDER]
  if (!provider) throw new AiError('NOT_CONFIGURED', `Unknown AI_PROVIDER "${env.AI_PROVIDER}".`)
  if (!env.AI_MODEL) throw new AiError('NOT_CONFIGURED', 'AI_MODEL is not set.')
  return { provider, model: env.AI_MODEL }
}

export const aiKeySet = () => !!PROVIDERS[env.AI_PROVIDER]?.hasKey()

// Prices change, so they are configuration, not code. Null when no price is set.
export function estimateCostUsd(inputTokens: number, outputTokens: number): number | null {
  const { AI_INPUT_COST_PER_MILLION: i, AI_OUTPUT_COST_PER_MILLION: o } = env
  if (i === undefined || o === undefined) return null
  return (inputTokens * i + outputTokens * o) / 1_000_000
}

// Per-organisation switch, off unless the organisation is listed in AI_ALLOWED_ORGS.
export const aiAllowedFor = (organizationId: string | null | undefined) => !!organizationId && (env.AI_ALLOWED_ORGS.includes('*') || env.AI_ALLOWED_ORGS.includes(organizationId))
