import { env } from '../config/env.js'
import { callProvider } from './http.js'
import { AiError, type AiFile, type AiJsonResult, type AiProvider } from './types.js'

const DEFAULT_BASE = 'https://generativelanguage.googleapis.com/v1beta'

function call(path: string, body?: unknown) {
  const key = env.GEMINI_API_KEY
  if (!key) throw new AiError('NOT_CONFIGURED', 'GEMINI_API_KEY is not set.')
  return callProvider(`${env.GEMINI_BASE_URL ?? DEFAULT_BASE}${path}`, { 'x-goog-api-key': key }, body)
}

interface GenerateResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

export const gemini: AiProvider = {
  name: 'gemini',
  hasKey: () => !!env.GEMINI_API_KEY,
  async testConnection(model) {
    await call(`/models/${encodeURIComponent(model)}`)
  },
  async generateJson(model, { prompt, file, schema }: { prompt: string; file: AiFile; schema: Record<string, unknown> }): Promise<AiJsonResult> {
    const body = {
      contents: [{ role: 'user', parts: [{ text: prompt }, { inlineData: { mimeType: file.mimeType, data: file.data.toString('base64') } }] }],
      generationConfig: { responseMimeType: 'application/json', responseSchema: schema, temperature: 0 },
    }
    const r = await call(`/models/${encodeURIComponent(model)}:generateContent`, body) as GenerateResponse
    const text = r.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? ''
    let json: unknown
    try { json = JSON.parse(text) } catch { throw new AiError('BAD_RESPONSE', 'The AI service did not return valid JSON.') }
    return { json, inputTokens: r.usageMetadata?.promptTokenCount ?? 0, outputTokens: r.usageMetadata?.candidatesTokenCount ?? 0 }
  },
}
