import { Prisma } from '../../../generated/prisma/client.js'

// Exact decimal arithmetic. 60 significant digits is far beyond any input, so nothing is rounded
// before display, as workbook tab 08 requires (R-02, R-03, R-04).
export const D = Prisma.Decimal.clone({ precision: 60 })
export type Dec = InstanceType<typeof D>
export const dec = (v: Prisma.Decimal | string | number) => new D(v.toString())
export const ZERO = new D(0)
