// HTTP-level protections that apply to every request, before any route runs.
import type { RequestHandler } from 'express'
import { env } from '../config/env.js'
import { HttpError } from './errorHandler.js'

// Vite moves to the next free port (5174, …) when 5173 is taken, so local development accepts any localhost port.
const devOrigin = /^http:\/\/(localhost|127\.0\.0\.1):\d+$/
export const allowedOrigin = (origin: string) => origin === env.CORS_ORIGIN || (env.NODE_ENV !== 'production' && devOrigin.test(origin))

// The single-page app uses inline style attributes, hence 'unsafe-inline' for styles only; scripts are same-origin files.
const CSP = [
  "default-src 'self'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "img-src 'self' data:",
  "font-src 'self'", "connect-src 'self'", "object-src 'none'", "base-uri 'self'", "form-action 'self'", "frame-ancestors 'none'",
  ...(env.NODE_ENV === 'production' ? ['upgrade-insecure-requests'] : []),
].join('; ')

export const securityHeaders: RequestHandler = (req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff')
  res.setHeader('X-Frame-Options', 'DENY')
  res.setHeader('Referrer-Policy', 'same-origin')
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()')
  res.setHeader('Content-Security-Policy', CSP)
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin')
  res.setHeader('Cross-Origin-Resource-Policy', 'same-origin') // other sites cannot embed or read our responses
  res.setHeader('X-Permitted-Cross-Domain-Policies', 'none')
  res.setHeader('X-DNS-Prefetch-Control', 'off')
  res.setHeader('Origin-Agent-Cluster', '?1')
  if (env.NODE_ENV === 'production') res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains')
  if (req.path.startsWith('/api')) res.setHeader('Cache-Control', 'no-store') // signed-in data never lands in a shared cache
  next()
}

// CSRF defence: a browser always says where a state-changing request comes from. Requests from any
// other site are refused, on top of the SameSite cookie. Non-browser clients send neither header.
export const sameOriginWrites: RequestHandler = (req, _res, next) => {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
  const origin = req.headers.origin
  if (req.headers['sec-fetch-site'] === 'cross-site' || (origin && !allowedOrigin(origin))) {
    throw new HttpError(403, 'Cross-site request refused')
  }
  next()
}

// Fixed-window counter per key. ponytail: in-process memory, so each server process counts separately
// and a restart resets it; move to the database or Redis if the app runs on several processes.
export class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>()
  constructor(private max: number, private windowMs: number, private now = () => Date.now()) {}

  // True when the attempt is allowed.
  take(key: string): boolean {
    const t = this.now()
    if (this.hits.size > 10_000) for (const [k, v] of this.hits) if (v.resetAt <= t) this.hits.delete(k)
    const entry = this.hits.get(key)
    if (!entry || entry.resetAt <= t) {
      this.hits.set(key, { count: 1, resetAt: t + this.windowMs })
      return true
    }
    entry.count += 1
    return entry.count <= this.max
  }
}

const authLimiter = new RateLimiter(env.AUTH_RATE_LIMIT, 15 * 60 * 1000)
// Every API call, per client IP: far above normal use, it stops scraping and automated abuse.
const apiLimiter = new RateLimiter(env.NODE_ENV === 'test' ? 1_000_000 : 600, 60 * 1000)
export const apiRateLimit: RequestHandler = (req, _res, next) => {
  if (!apiLimiter.take(req.ip ?? 'unknown')) throw new HttpError(429, 'Too many requests. Please wait a minute and try again.')
  next()
}

// Limits password and code guessing per client IP, across all accounts (account lockout covers one account).
export const authRateLimit: RequestHandler = (req, _res, next) => {
  if (!authLimiter.take(req.ip ?? 'unknown')) throw new HttpError(429, 'Too many attempts from this network. Try again in 15 minutes.')
  next()
}
