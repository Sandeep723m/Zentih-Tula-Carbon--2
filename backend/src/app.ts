import { readFileSync } from 'node:fs'
import path from 'node:path'
import { gzipSync } from 'node:zlib'
import cors from 'cors'
import express from 'express'
import { env } from './config/env.js'
import { errorHandler, notFound } from './middleware/errorHandler.js'
import { allowedOrigin, apiRateLimit, sameOriginWrites, securityHeaders } from './middleware/security.js'
import { apiRouter } from './routes/index.js'

export const app = express()
app.disable('x-powered-by')
// Behind cPanel's Passenger (or any local reverse proxy) the client IP arrives in X-Forwarded-For;
// it is trusted only from the loopback interface, so a remote client cannot fake its IP.
app.set('trust proxy', 'loopback')

app.use(securityHeaders)
app.use(cors({ origin: (origin, ok) => ok(null, !origin || allowedOrigin(origin)), credentials: true }))
app.use('/api', apiRateLimit, sameOriginWrites)
app.use(express.json({ limit: '1mb' }))
app.use('/api', apiRouter)

// Single-domain hosting (cPanel): serve the built frontend, and index.html for its client-side routes.
if (env.FRONTEND_DIR) {
  const dir = path.resolve(env.FRONTEND_DIR)
  // Built files are named by content hash, so they never change: compress each once, keep it in memory,
  // and let browsers cache it for a year. index.html is always revalidated so a deploy shows at once.
  const gz = new Map<string, Buffer>()
  const TYPES: Record<string, string> = { '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.json': 'application/json' }
  app.use('/static', (req, res, next) => {
    const type = TYPES[path.extname(req.path)]
    const file = path.join(dir, 'static', path.normalize(req.path))
    if (!type || !file.startsWith(path.join(dir, 'static')) || !/\bgzip\b/.test(String(req.headers['accept-encoding']))) return next()
    let body = gz.get(file)
    try { body ??= gzipSync(readFileSync(file)); gz.set(file, body) } catch { return next() }
    res.set({ 'Content-Type': type, 'Content-Encoding': 'gzip', Vary: 'Accept-Encoding', 'Cache-Control': 'public, max-age=31536000, immutable' }).send(body)
  })
  app.use(express.static(dir, {
    setHeaders: (res, file) => res.setHeader('Cache-Control', file.includes(`${path.sep}static${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache'),
  }))
  app.use((req, res, next) => ((req.method === 'GET' || req.method === 'HEAD') && !req.path.startsWith('/api') ? res.setHeader('Cache-Control', 'no-cache').sendFile(path.join(dir, 'index.html')) : next()))
}

app.use(notFound)
app.use(errorHandler)
