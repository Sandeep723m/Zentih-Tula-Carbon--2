import type { RequestHandler } from 'express'
import { z, type ZodType } from 'zod'

// Convention: each route validates its body with a zod schema; failures
// throw ZodError, which errorHandler turns into a 400.
export const validateBody = (schema: ZodType): RequestHandler => (req, _res, next) => {
  req.body = schema.parse(req.body)
  next()
}

// Optional free-text field: blank input is stored as null.
export const optionalText = (max: number) =>
  z.string().trim().max(max).nullish().transform((s) => (s === undefined ? undefined : s || null)) // undefined = "not sent", keeps PATCH partial
