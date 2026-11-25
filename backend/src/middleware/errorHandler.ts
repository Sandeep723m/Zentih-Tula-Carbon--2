import type { ErrorRequestHandler, RequestHandler } from 'express'
import { ZodError } from 'zod'

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: Record<string, unknown>) {
    super(message)
  }
}

export const notFound: RequestHandler = (req, _res, next) => {
  next(new HttpError(404, `Route not found: ${req.method} ${req.originalUrl}`))
}

export const errorHandler: ErrorRequestHandler = (err, _req, res, _next) => {
  if (err instanceof ZodError) {
    res.status(400).json({ error: 'Validation failed', details: err.issues })
    return
  }
  if (err?.code === 'P2002') { // Prisma unique-constraint violation
    res.status(409).json({ error: 'A record with this name or code already exists' })
    return
  }
  if (err?.type === 'entity.too.large') {
    res.status(413).json({ error: 'The upload is too large' })
    return
  }
  // body-parser errors (bad JSON etc.) carry a safe 4xx status and message
  const status = err instanceof HttpError ? err.status : err?.expose && err.status < 500 ? err.status : 500
  if (status === 500) console.error(err)
  const body: Record<string, unknown> = { error: status === 500 ? 'Internal server error' : err.message }
  if (err instanceof HttpError && err.details) Object.assign(body, err.details)
  res.status(status).json(body)
}
