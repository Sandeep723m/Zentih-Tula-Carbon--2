import type { Prisma } from '../../generated/prisma/client.js'
import { getPrisma } from '../config/database.js'

type Db = Prisma.TransactionClient | ReturnType<typeof getPrisma>

export interface AuditEntry {
  organizationId?: string | null
  actorUserId?: string | null
  action: string
  entityType: string
  entityId?: string | null
  before?: unknown // any record; serialised to plain JSON (Dates become ISO strings)
  after?: unknown
  reason?: string
}

// Pass the transaction client when the audited change happens in a transaction,
// so the change and its audit entry commit or roll back together.
export function writeAudit(entry: AuditEntry, db: Db = getPrisma()) {
  const json = (v: unknown) => (v === undefined ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue))
  return db.auditLog.create({ data: { ...entry, before: json(entry.before), after: json(entry.after) } })
}
