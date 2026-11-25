// Loads the calculation reference data (workbook TC-DOM-002a) into this database. Safe to re-run.
//   npm run reference:seed        (server: npm run reference:seed:prod)
import { seedReferenceData } from '../src/calc/referenceData.js'
import { getPrisma } from '../src/config/database.js'

const db = getPrisma()
await seedReferenceData(db)
console.log(`Reference data ready: ${await db.activityType.count()} activity types, ${await db.unit.count()} units, ${await db.gridRegion.count()} grid regions, ${await db.emissionFactor.count()} emission factors.`)
await db.$disconnect()
