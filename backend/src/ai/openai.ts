import { env } from '../config/env.js'
import { callProvider } from './http.js'
import { AiError, type AiFile, type AiJsonResult, type AiProvider } from './types.js'

const DEFAULT_BASE = 'https://api.openai.com/v1'

function call(path: string, body?: unknown) {
  const key = env.OPENAI_API_KEY
  if (!key) throw new AiError('NOT_CONFIGURED', 'OPENAI_API_KEY is not set.')
  return callProvider(`${env.OPENAI_BASE_URL ?? DEFAULT_BASE}${path}`, { authorization: `Bearer ${key}` }, body)
}

// Strict structured output: lower-case types, every property required, nullable written as a type list.
function strictSchema(node: Record<string, unknown>): Record<string, unknown> {
  const type = String(node.type).toLowerCase()
  const { nullable, properties, ...rest } = node
  const out: Record<string, unknown> = { ...rest, type: nullable ? [type, 'null'] : type }
  if (rest.items) out.items = strictSchema(rest.items as Record<string, unknown>)
  if (properties) {
    const props = properties as Record<string, Record<string, unknown>>
    out.properties = Object.fromEntries(Object.entries(props).map(([k, v]) => [k, strictSchema(v)]))
    out.required = Object.keys(props)
    out.additionalProperties = false
  }
  return out
}

const filePart = (file: AiFile) => {
  const b64 = file.data.toString('base64')
  if (file.mimeType === 'text/csv') return { type: 'input_text', text: `Document contents (CSV):\n${file.data.toString('utf8')}` }
  if (file.mimeType.startsWith('image/')) return { type: 'input_image', image_url: `data:${file.mimeType};base64,${b64}` }
  return { type: 'input_file', filename: 'document.pdf', file_data: `data:${file.mimeType};base64,${b64}` }
}

interface ResponsesResult {
  output?: Array<{ content?: Array<{ type?: string; text?: string }> }>
  usage?: { input_tokens?: number; output_tokens?: number }
}

export const openai: AiProvider = {
  name: 'openai',
  hasKey: () => !!env.OPENAI_API_KEY,
  async testConnection(model) {
    await call(`/models/${encodeURIComponent(model)}`)
  },
  async generateJson(model, { prompt, file, schema }): Promise<AiJsonResult> {
    const r = await call('/responses', {
      model,
      store: false, // documents are not kept by the provider for later retrieval
      input: [{ role: 'user', content: [{ type: 'input_text', text: prompt }, filePart(file)] }],
      text: { format: { type: 'json_schema', name: 'document_fields', strict: true, schema: strictSchema(schema) } },
    }) as ResponsesResult
    const text = (r.output ?? []).flatMap((o) => o.content ?? []).filter((c) => c.type === 'output_text').map((c) => c.text ?? '').join('')
    let json: unknown
    try { json = JSON.parse(text) } catch { throw new AiError('BAD_RESPONSE', 'The AI service did not return valid JSON.') }
    return { json, inputTokens: r.usage?.input_tokens ?? 0, outputTokens: r.usage?.output_tokens ?? 0 }
  },
}
