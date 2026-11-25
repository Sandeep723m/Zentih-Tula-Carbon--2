import type { RequestHandler } from 'express'
import { getPrisma } from '../config/database.js'

// For uptime monitors: 200 only when the app can reach its database, else 503. No details are exposed.
export const getHealth: RequestHandler = async (_req, res) => {
  const timestamp = new Date().toISOString()
  try {
    await getPrisma().$queryRaw`SELECT 1`
    res.json({ status: 'ok', service: 'tula-carbon-backend', timestamp })
  } catch (e) {
    console.error('Health check: database unreachable:', (e as Error).message)
    res.status(503).json({ status: 'unavailable', service: 'tula-carbon-backend', timestamp })
  }
}
