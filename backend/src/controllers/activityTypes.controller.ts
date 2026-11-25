// Super Admin: each activity's formula and accepted units, with the workbook default beside them.
// Only formulas the engine already implements can be chosen, and only those whose inputs match the workbook's
// one (so existing records stay valid). Units are limited to what that formula can convert, and a unit that
// records already use cannot be removed. Past calculation results never change: they store the formula and
// inputs they were calculated with. Every change needs a reason and is written to the audit trail.
import type { RequestHandler } from 'express'
import { z } from 'zod'
import type { Prisma } from '../../generated/prisma/client.js'
import { ACTIVITY_TYPES } from '../calc/referenceData.js'
import { FORMULA_INFO, formulaChoices, methodsFor, parametersFor } from '../calc/registry.js'
import { getPrisma, isMySql } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'

const WORKBOOK = new Map<string, { formulaCode: string | null; allowedUnits: string[] }>(ACTIVITY_TYPES.map((a) => [a.code, { formulaCode: a.formulaCode, allowedUnits: [...a.allowedUnits] }]))
const units = (v: unknown) => (Array.isArray(v) ? (v as string[]) : [])
const sameSet = (a: string[], b: string[]) => a.length === b.length && a.every((x) => b.includes(x))
const changedFromWorkbook = (t: { code: string; formulaCode: string | null; allowedUnits: unknown }) => {
  const w = WORKBOOK.get(t.code)
  return !!w && (w.formulaCode !== t.formulaCode || !sameSet(w.allowedUnits, units(t.allowedUnits)))
}
const formulaTitle = (code: string | null) => (code ? methodsFor(code).map((m) => m.title).join(' + ') || code : null)

export const ACTIVITY_TYPE_PAGE_SIZE = 50
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
  changed: z.enum(['1']).optional(),
  page: z.coerce.number().int().min(1).max(10_000).default(1),
})

// ponytail: the workbook's activity list is bounded (about a hundred rows), so "changed from workbook" is worked
// out in memory before paging; move it into a stored column if Super Admins ever add thousands of activities.
export const listActivityTypesAdmin: RequestHandler = async (req, res) => {
  const { q, category, changed, page } = listQuery.parse(req.query)
  const like = q ? (isMySql() ? { contains: q } : { contains: q, mode: 'insensitive' as const }) : undefined
  const where: Prisma.ActivityTypeWhereInput = like ? { OR: [{ code: like }, { name: like }, { category: like }] } : {}
  const all = await getPrisma().activityType.findMany({ where, orderBy: [{ category: 'asc' }, { code: 'asc' }], select: { code: true, name: true, category: true, scope: true, formulaCode: true, allowedUnits: true, measuredIn: true } })
  const counts: Record<string, number> = {}
  for (const t of all) counts[t.category] = (counts[t.category] ?? 0) + 1
  const changedCount = all.filter(changedFromWorkbook).length
  const filtered = all.filter((t) => (!category || t.category === category) && (!changed || changedFromWorkbook(t)))
  const rows = filtered.slice((page - 1) * ACTIVITY_TYPE_PAGE_SIZE, page * ACTIVITY_TYPE_PAGE_SIZE).map((t) => ({ ...t, allowedUnits: units(t.allowedUnits), changed: changedFromWorkbook(t) }))
  res.json({ rows, total: filtered.length, page, pageSize: ACTIVITY_TYPE_PAGE_SIZE, counts, changedCount })
}

// Records anywhere that are measured as this activity: sources naming it, and sources with no activity chosen
// whose category resolves to it (grid electricity).
const recordsOf = (code: string, sourceCategory: string | null): Prisma.ActivityRecordWhereInput => ({
  OR: [{ emissionSource: { activityCode: code } }, ...(sourceCategory ? [{ emissionSource: { activityCode: null, category: sourceCategory as Prisma.EnumSourceCategoryFilter['equals'] } }] : [])],
})

async function detailOf(code: string) {
  const db = getPrisma()
  const t = await db.activityType.findUnique({ where: { code } })
  if (!t) throw new HttpError(404, 'Activity not found')
  const workbook = WORKBOOK.get(code) ?? { formulaCode: t.formulaCode, allowedUnits: units(t.allowedUnits) }
  const [allUnits, byUnit, sources, history] = await Promise.all([
    db.unit.findMany({ orderBy: [{ dimension: 'asc' }, { code: 'asc' }] }),
    db.activityRecord.groupBy({ by: ['unit'], where: recordsOf(code, t.sourceCategory), _count: true }),
    db.emissionSource.count({ where: { activityCode: code } }),
    db.auditLog.findMany({ where: { entityType: 'ActivityType', entityId: code }, orderBy: { createdAt: 'desc' }, take: 50 }),
  ])
  const actors = await db.user.findMany({ where: { id: { in: history.map((h) => h.actorUserId).filter((x): x is string => !!x) } }, select: { id: true, name: true } })
  const choices = formulaChoices(workbook.formulaCode, t.carbonOrigin)
  // Units each formula may accept: the dimensions its code converts, plus the workbook's own list (effluent units).
  // Fuels: gas volumes (SCM, scf) only for gaseous fuels, and never the cooling unit ton-hour.
  const unitOptions = (formula: string | null) => {
    if (!formula) return allUnits.map((u) => u.code)
    const fuel = ['C-01', 'C-02', 'C-03'].includes(formula)
    const gas = workbook.allowedUnits.includes('SCM')
    const dims = (FORMULA_INFO[formula]?.dimensions ?? []).filter((d) => !(fuel && !gas && d === 'Volume (gas)'))
    const fits = allUnits.filter((u) => dims.includes(u.dimension) && !(fuel && u.code === 'ton-hour'))
    return [...new Set([...fits.map((u) => u.code), ...workbook.allowedUnits])]
  }
  const inUse = Object.fromEntries(byUnit.map((b) => [b.unit, b._count]))
  return {
    t, workbook, choices, allUnits, inUse, sources, unitOptions,
    view: {
      code: t.code, name: t.name, category: t.category, scope: t.scope, carbonOrigin: t.carbonOrigin, measuredIn: t.measuredIn,
      defaultNcv: t.defaultNcv?.toString() ?? null, notes: t.notes,
      formulaCode: t.formulaCode, formulaTitle: formulaTitle(t.formulaCode), equation: t.formulaCode ? FORMULA_INFO[t.formulaCode]?.equation ?? [] : [],
      inputs: parametersFor(t.formulaCode).fields.map((f) => f.label),
      allowedUnits: units(t.allowedUnits),
      units: allUnits.filter((u) => units(t.allowedUnits).includes(u.code)).map((u) => ({ code: u.code, name: u.name, dimension: u.dimension, toBase: u.toBase.toString(), baseUnit: u.baseUnit })),
      workbook: { ...workbook, formulaTitle: formulaTitle(workbook.formulaCode) },
      changed: changedFromWorkbook(t),
      usage: { sources, records: byUnit.reduce((s, b) => s + b._count, 0), byUnit: inUse },
      options: {
        formulas: [...choices.map((c) => ({ code: c, title: formulaTitle(c)!, units: unitOptions(c) })), { code: null, title: 'Not calculated', units: unitOptions(null) }],
        allUnits: allUnits.map((u) => ({ code: u.code, name: u.name, dimension: u.dimension })),
        locked: lockedUnits(t, workbook, inUse),
      },
      history: history.map((h) => ({ id: h.id, createdAt: h.createdAt, actor: actors.find((a) => a.id === h.actorUserId)?.name ?? null, reason: h.reason, before: h.before, after: h.after })),
    },
  }
}

// Units that must stay accepted: those records already use (removing one would block them), the unit the
// workbook measures the activity in, and for fuels "SCM", which tells the engine a fuel is a gas (GCV to NCV).
function lockedUnits(t: { formulaCode: string | null }, workbook: { allowedUnits: string[] }, inUse: Record<string, number>) {
  const locked: Record<string, string> = {}
  for (const [u, n] of Object.entries(inUse)) locked[u] = `${n} record${n === 1 ? '' : 's'} use it`
  if (workbook.allowedUnits.includes('SCM') && ['C-01', 'C-02', 'C-03'].includes(t.formulaCode ?? '')) locked.SCM ??= 'Marks this fuel as a gas for the calorific value conversion'
  return locked
}

export const getActivityTypeAdmin: RequestHandler = async (req, res) => {
  res.json((await detailOf(String(req.params.code))).view)
}

export const updateActivityTypeSchema = z.object({
  formulaCode: z.string().trim().max(10).nullable(),
  allowedUnits: z.array(z.string().trim().min(1).max(20)).max(40),
  reason: z.string().trim().min(5, 'Say why this is changed (at least 5 characters)').max(500),
})

export const updateActivityTypeAdmin: RequestHandler = async (req, res) => {
  const b = req.body as z.infer<typeof updateActivityTypeSchema>
  const { t, workbook, choices, allUnits, inUse, unitOptions } = await detailOf(String(req.params.code))
  const wanted = [...new Set(b.allowedUnits)]
  if (b.formulaCode !== null && !choices.includes(b.formulaCode)) {
    throw new HttpError(400, choices.length ? `This activity can use ${choices.join(' or ')}, or be not calculated.` : 'No calculation exists for this activity yet; it can only stay not calculated.')
  }
  const unknown = wanted.filter((u) => !allUnits.some((x) => x.code === u))
  if (unknown.length) throw new HttpError(400, `Unknown unit: ${unknown.join(', ')}`)
  const unsupported = wanted.filter((u) => !unitOptions(b.formulaCode).includes(u))
  if (unsupported.length) throw new HttpError(400, `${b.formulaCode} cannot convert ${unsupported.join(', ')}. Choose units it can calculate.`)
  if (b.formulaCode && !wanted.length) throw new HttpError(400, 'A calculated activity needs at least one unit.')
  const missing = Object.entries(lockedUnits({ formulaCode: b.formulaCode }, workbook, inUse)).filter(([u]) => !wanted.includes(u))
  if (missing.length) throw new HttpError(400, `Keep ${missing.map(([u, why]) => `${u} (${why})`).join(', ')}.`)
  if (['C-01', 'C-02', 'C-03'].includes(b.formulaCode ?? '') && !workbook.allowedUnits.includes('SCM') && wanted.includes('SCM')) {
    throw new HttpError(400, 'SCM is only for gaseous fuels; this fuel is not a gas.')
  }
  const before = { formulaCode: t.formulaCode, allowedUnits: units(t.allowedUnits) }
  if (before.formulaCode === b.formulaCode && sameSet(before.allowedUnits, wanted)) throw new HttpError(400, 'Nothing has changed.')

  const after = { formulaCode: b.formulaCode, allowedUnits: wanted }
  await getPrisma().$transaction(async (tx) => {
    await tx.activityType.update({ where: { code: t.code }, data: after })
    const restored = workbook.formulaCode === after.formulaCode && sameSet(workbook.allowedUnits, after.allowedUnits)
    await writeAudit({ actorUserId: req.auth!.userId, action: restored ? 'activity_type.restored' : 'activity_type.updated', entityType: 'ActivityType', entityId: t.code, before, after, reason: b.reason }, tx)
  })
  res.json((await detailOf(t.code)).view)
}
