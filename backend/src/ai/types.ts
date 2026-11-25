// What the rest of the app knows about AI: one interface, so a provider can be swapped by configuration alone.
export type AiErrorCode = 'NOT_CONFIGURED' | 'INVALID_KEY' | 'QUOTA' | 'TIMEOUT' | 'NETWORK' | 'UNAVAILABLE' | 'BAD_RESPONSE' | 'MODEL_NOT_FOUND'

export class AiError extends Error {
  constructor(public code: AiErrorCode, message: string) { super(message) }
}

export interface AiFile { mimeType: string; data: Buffer }
export interface AiJsonResult { json: unknown; inputTokens: number; outputTokens: number }

export interface AiProvider {
  name: string
  hasKey(): boolean
  // Confirms the key and model work, without spending tokens.
  testConnection(model: string): Promise<void>
  // Returns JSON matching `schema` (a JSON-Schema subset) for the instructions and file.
  generateJson(model: string, input: { prompt: string; file: AiFile; schema: Record<string, unknown> }): Promise<AiJsonResult>
}
