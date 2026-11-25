// Renewable electricity instruments, their allocation to electricity records, and the checks each claim must pass
// before it can lower market-based Scope 2. Location-based figures are never affected by any of this.
import type { RequestHandler } from 'express'
import { z } from 'zod'
import { orgId } from '../auth/session.js'
import { getPrisma } from '../config/database.js'
import { HttpError } from '../middleware/errorHandler.js'
import { writeAudit } from '../services/audit.js'

// Versioned so a report can say which criteria a claim was checked against.
export const ELIGIBILITY_RULES_VERSION = 'Scope 2 quality criteria, v1'
const TO_MWH: Record<string, number> = { kwh: 0.001, mwh: 1, gwh: 1000, gj: 1 / 3.6 }
const mwhOf = (quantity: unknown, unit: string) => { const f = TO_MWH[unit.trim().toLowerCase()]; return f === undefined ? null : Number(quantity) * f }
const day = (d: Date) => d.toISOString().slice(0, 10)
const r6 = (n: number) => Math.round(n * 1e6) / 1e6

type Instrument = Awaited<ReturnType<typeof loadInstruments>>[number]
async function loadInstruments(organizationId: string) {
  return getPrisma().energyInstrument.findMany({
    where: { organizationId }, orderBy: { createdAt: 'desc' },
    include: { allocations: true },
  })
}

// Each criterion separately, so a person sees exactly why a claim does or does not qualify.
function checks(i: Instrument, ctx: { periodStart?: Date; periodEnd?: Date; facilityCountry?: string | null }) {
  const allocated = i.allocations.reduce((s, a) => s + Number(a.mwh), 0)
  const list = [
    { code: 'RETIRED', ok: !!i.retiredAt && i.retiredForOrg, message: i.retiredAt ? (i.retiredForOrg ? `Retired on ${day(i.retiredAt)} on your behalf.` : 'Retired, but not confirmed as retired on your behalf.') : 'Not yet retired. A certificate counts only once it is retired or cancelled for you.' },
    { code: 'NO_DOUBLE_COUNT', ok: allocated <= Number(i.quantityMWh) + 1e-9, message: `${r6(allocated)} of ${r6(Number(i.quantityMWh))} MWh allocated.` },
  ]
  if (ctx.periodStart && ctx.periodEnd) {
    const overlaps = i.generationFrom <= ctx.periodEnd && i.generationTo >= ctx.periodStart
    list.push({ code: 'VINTAGE', ok: overlaps, message: overlaps ? 'Generated within the reporting period.' : `Generated ${day(i.generationFrom)} to ${day(i.generationTo)}, outside the reporting period.` })
  }
  if (ctx.facilityCountry !== undefined) {
    const known = !!i.country && !!ctx.facilityCountry
    const same = known && i.country!.trim().toLowerCase() === ctx.facilityCountry!.trim().toLowerCase()
    list.push({ code: 'SAME_MARKET', ok: same, message: !known ? 'The market of the instrument or the facility is not recorded; it must be the same market as the consumption.' : same ? `Same market (${i.country}).` : `Generated in ${i.country}, consumed in ${ctx.facilityCountry}.` })
  }
  return list
}

export const listInstruments: RequestHandler = async (req, res) => {
  const list = await loadInstruments(orgId(req))
  res.json({ rulesVersion: ELIGIBILITY_RULES_VERSION, rows: list.map((i) => {
    const allocated = i.allocations.reduce((s, a) => s + Number(a.mwh), 0)
    return { ...i, allocated: r6(allocated), remaining: r6(Number(i.quantityMWh) - allocated), checks: checks(i, {}) }
  }) })
}

export const instrumentSchema = z.object({
  type: z.enum(['I_REC', 'REC', 'PPA', 'GREEN_TARIFF', 'OTHER_EAC']), reference: z.string().trim().min(1).max(120),
  issuer: z.string().trim().max(120).nullable().optional(), supplier: z.string().trim().max(120).nullable().optional(),
  quantityMWh: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Enter MWh as a number'),
  generationFrom: z.iso.date(), generationTo: z.iso.date(), country: z.string().trim().max(60).nullable().optional(),
  retiredAt: z.iso.date().nullable().optional(), retiredForOrg: z.boolean().default(false),
  emissionFactor: z.string().regex(/^\d{1,8}(\.\d{1,12})?$/).nullable().optional(), notes: z.string().trim().max(190).nullable().optional(),
}).refine((b) => b.generationTo >= b.generationFrom, { message: 'Generation must end on or after it starts', path: ['generationTo'] })

export const createInstrument: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const b = req.body as z.infer<typeof instrumentSchema>
  if (Number(b.quantityMWh) <= 0) throw new HttpError(400, 'The quantity must be more than zero')
  const db = getPrisma()
  if (await db.energyInstrument.findFirst({ where: { organizationId, type: b.type, reference: b.reference } })) throw new HttpError(409, 'This instrument is already registered.')
  const i = await db.$transaction(async (tx) => {
    const created = await tx.energyInstrument.create({ data: { ...b, organizationId, generationFrom: new Date(b.generationFrom), generationTo: new Date(b.generationTo), retiredAt: b.retiredAt ? new Date(b.retiredAt) : null, createdById: req.auth!.userId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'instrument.registered', entityType: 'EnergyInstrument', entityId: created.id, after: b }, tx)
    return created
  })
  res.status(201).json({ id: i.id })
}

export const retireSchema = z.object({ retiredAt: z.iso.date(), retiredForOrg: z.literal(true) })

export const retireInstrument: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const i = await getPrisma().energyInstrument.findFirst({ where: { id: req.params.id as string, organizationId } })
  if (!i) throw new HttpError(404, 'Instrument not found')
  const { retiredAt } = req.body as z.infer<typeof retireSchema>
  await getPrisma().$transaction(async (tx) => {
    await tx.energyInstrument.update({ where: { id: i.id }, data: { retiredAt: new Date(retiredAt), retiredForOrg: true } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'instrument.retired', entityType: 'EnergyInstrument', entityId: i.id, after: { retiredAt } }, tx)
  })
  res.status(204).end()
}

export const allocationSchema = z.object({ activityRecordId: z.uuid(), mwh: z.string().regex(/^\d{1,14}(\.\d{1,6})?$/, 'Enter MWh as a number') })

// Allocation never touches the record: its market-based inputs change only through the normal edit and review steps.
export const allocate: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const { activityRecordId, mwh } = req.body as z.infer<typeof allocationSchema>
  const db = getPrisma()
  await db.$transaction(async (tx) => {
    const i = await tx.energyInstrument.findFirst({ where: { id: req.params.id as string, organizationId }, include: { allocations: true } })
    if (!i) throw new HttpError(404, 'Instrument not found')
    const rec = await tx.activityRecord.findFirst({ where: { id: activityRecordId, organizationId }, include: { emissionSource: { select: { category: true } } } })
    if (!rec) throw new HttpError(404, 'Record not found')
    if (rec.emissionSource.category !== 'PURCHASED_ELECTRICITY') throw new HttpError(400, 'Renewable instruments can only cover purchased electricity.')
    const consumed = mwhOf(rec.quantity, rec.unit)
    if (consumed === null) throw new HttpError(400, `The record's unit (${rec.unit}) cannot be converted to MWh.`)
    if (i.allocations.some((a) => a.activityRecordId === rec.id)) throw new HttpError(409, 'This instrument is already allocated to that record.')
    const left = Number(i.quantityMWh) - i.allocations.reduce((s, a) => s + Number(a.mwh), 0)
    if (Number(mwh) <= 0 || Number(mwh) > left + 1e-9) throw new HttpError(400, `Only ${r6(left)} MWh of this instrument is left to allocate.`)
    const onRecord = (await tx.instrumentAllocation.findMany({ where: { organizationId, activityRecordId: rec.id } })).reduce((s, a) => s + Number(a.mwh), 0)
    if (onRecord + Number(mwh) > consumed + 1e-9) throw new HttpError(400, `The record used ${r6(consumed)} MWh and ${r6(onRecord)} MWh is already covered.`)
    const a = await tx.instrumentAllocation.create({ data: { organizationId, instrumentId: i.id, activityRecordId: rec.id, mwh, allocatedById: req.auth!.userId } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'instrument.allocated', entityType: 'EnergyInstrument', entityId: i.id, after: { allocationId: a.id, activityRecordId, mwh } }, tx)
  })
  res.status(204).end()
}

export const removeAllocation: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const a = await getPrisma().instrumentAllocation.findFirst({ where: { id: req.params.allocationId as string, organizationId } })
  if (!a) throw new HttpError(404, 'Allocation not found')
  await getPrisma().$transaction(async (tx) => {
    await tx.instrumentAllocation.delete({ where: { id: a.id } })
    await writeAudit({ organizationId, actorUserId: req.auth!.userId, action: 'instrument.deallocated', entityType: 'EnergyInstrument', entityId: a.instrumentId, before: { activityRecordId: a.activityRecordId, mwh: a.mwh.toString() } }, tx)
  })
  res.status(204).end()
}

// One period: consumption, what eligible instruments cover, and location- versus market-based results, kept apart.
export const renewablesSummary: RequestHandler = async (req, res) => {
  const organizationId = orgId(req)
  const db = getPrisma()
  const period = await db.reportingPeriod.findFirst({ where: { id: String(req.query.reportingPeriodId ?? ''), organizationId } })
  if (!period) throw new HttpError(404, 'Reporting period not found')
  const [records, instruments] = await Promise.all([
    db.activityRecord.findMany({ where: { organizationId, reportingPeriodId: period.id, emissionSource: { category: 'PURCHASED_ELECTRICITY' } }, select: { id: true, quantity: true, unit: true, parameters: true, startDate: true, endDate: true, status: true, facility: { select: { code: true, country: true } }, emissionSource: { select: { name: true } } } }),
    loadInstruments(organizationId),
  ])
  const runId = period.finalRunId ?? (await db.calculationRun.findFirst({ where: { reportingPeriodId: period.id }, orderBy: { createdAt: 'desc' }, select: { id: true } }))?.id
  const lines = runId ? await db.calculationResult.groupBy({ by: ['line'], where: { runId, line: { in: ['SCOPE2_LOCATION', 'SCOPE2_MARKET'] } }, _sum: { tCO2e: true } }) : []
  const consumption = records.reduce((s, r) => s + (mwhOf(r.quantity, r.unit) ?? 0), 0)
  let eligible = 0, ineligible = 0
  const rows = records.map((r) => {
    const allocations = instruments.flatMap((i) => i.allocations.filter((a) => a.activityRecordId === r.id).map((a) => {
      const c = checks(i, { periodStart: period.startDate, periodEnd: period.endDate, facilityCountry: r.facility.country })
      const ok = c.every((x) => x.ok)
      if (ok) eligible += Number(a.mwh); else ineligible += Number(a.mwh)
      return { id: a.id, instrument: `${i.type.replace('_', '-')} ${i.reference}`, mwh: Number(a.mwh), eligible: ok, checks: c }
    }))
    const eligibleMWh = allocations.filter((a) => a.eligible).reduce((s, a) => s + a.mwh, 0)
    const onRecord = Number((r.parameters as { instrumentMWh?: string } | null)?.instrumentMWh ?? 0)
    return { id: r.id, record: `${r.facility.code} · ${r.emissionSource.name} · ${day(r.startDate)} to ${day(r.endDate)}`, status: r.status, consumedMWh: r6(mwhOf(r.quantity, r.unit) ?? 0), allocations,
      eligibleMWh: r6(eligibleMWh), recordInstrumentMWh: onRecord, matchesRecord: Math.abs(onRecord - eligibleMWh) < 1e-6 }
  })
  const sumOf = (line: string) => Number(lines.find((l) => l.line === line)?._sum.tCO2e ?? 0)
  res.json({
    rulesVersion: ELIGIBILITY_RULES_VERSION, period: { id: period.id, name: period.name },
    consumptionMWh: r6(consumption), coveredMWh: r6(eligible), notCoveredMWh: r6(consumption - eligible), ineligibleMWh: r6(ineligible),
    locationTCO2e: runId ? sumOf('SCOPE2_LOCATION') : null, marketTCO2e: runId ? sumOf('SCOPE2_MARKET') : null, rows,
  })
}
