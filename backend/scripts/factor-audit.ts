// READ-ONLY. Lists every emission factor someone added by hand (not from the workbook seed), plus any seeded row
// that no longer fits its activity: whether calculations can use it, why not, its status, and how many
// calculation results (and results in locked periods) reference it. Changes nothing; decide per row, then
// end-date unwanted ones from the Emission Factors page (a superseded factor stays, with its history).
//   npm run factor:audit        (server: npm run factor:audit:prod)
import { checkFactorShape, usableFactor } from '../src/calc/core/factorRules.js'
import { getPrisma } from '../src/config/database.js'

const db = getPrisma()
const [factors, activities, units] = await Promise.all([
  db.emissionFactor.findMany({ include: { createdBy: { select: { email: true } }, organization: { select: { name: true } } }, orderBy: { code: 'asc' } }),
  db.activityType.findMany(),
  db.unit.findMany(),
])
const byCode = new Map(activities.map((a) => [a.code, a]))
const rows = []
for (const f of factors) {
  const usable = usableFactor(f, byCode, units)
  const activity = f.activityCode ? byCode.get(f.activityCode) : undefined
  const phase2 = activity && !activity.formulaCode && activity.code !== 'A-PPA' // e.g. agriculture (tab 01 S-17)
  if (!f.createdById && (usable || phase2)) continue // a seeded workbook row that fits, or a reference-only row: nothing to review
  const shape = activity?.formulaCode ? checkFactorShape(f, activity, units) : null
  const [results, locked] = await Promise.all([
    db.calculationResult.count({ where: { emissionFactorId: f.id } }),
    db.calculationResult.count({ where: { emissionFactorId: f.id, run: { reportingPeriod: { status: 'LOCKED' } } } }),
  ])
  rows.push({
    code: f.code, activity: f.activityCode ?? 'all (GWP)', value: `${f.value} ${f.numeratorUnit} per ${f.denominatorUnit}`, gas: f.gas,
    source: f.source, addedBy: f.createdBy?.email ?? 'workbook seed', library: f.organization?.name ?? 'shared', status: f.status,
    usableByCalculations: usable, problem: shape && !shape.ok ? shape.message : phase2 ? 'activity has no calculation yet (Phase 2)' : usable ? '' : `status ${f.status}`, results, resultsInLockedPeriods: locked,
  })
}
console.log(JSON.stringify(rows, null, 2))
console.log(`${rows.length} factor(s) to review. Nothing was changed.`)
await db.$disconnect()
