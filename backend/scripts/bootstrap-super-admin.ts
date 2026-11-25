// Creates the first platform Super Admin. Safe to run repeatedly: an existing account is left untouched.
//   npm run platform:bootstrap
// Development uses admin@tulacarbon.com / admin@123 unless overridden. In production both
// BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD must be set, and the dev password is refused.
// The password must be changed at first sign-in either way.
import { hashPassword } from '../src/auth/crypto.js'
import { getPrisma } from '../src/config/database.js'
import { env } from '../src/config/env.js'
import { writeAudit } from '../src/services/audit.js'

const DEV_EMAIL = 'admin@tulacarbon.com'
const DEV_PASSWORD = 'admin@123'

const email = (process.env.BOOTSTRAP_ADMIN_EMAIL ?? (env.NODE_ENV === 'production' ? '' : DEV_EMAIL)).toLowerCase()
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? (env.NODE_ENV === 'production' ? '' : DEV_PASSWORD)
if (!email || !password) {
  console.error('In production, set BOOTSTRAP_ADMIN_EMAIL and BOOTSTRAP_ADMIN_PASSWORD.')
  process.exit(1)
}
if (env.NODE_ENV === 'production' && password === DEV_PASSWORD) {
  console.error('Refusing to use the development password in production.')
  process.exit(1)
}

const db = getPrisma()
const existing = await db.user.findUnique({ where: { email } })
if (existing?.platformRole === 'SUPER_ADMIN') {
  console.log(`Super Admin ${email} already exists. Nothing changed.`)
} else if (existing) {
  console.error(`${email} is an existing organisation account. Use a different email for the Super Admin.`)
  process.exit(1)
} else {
  const user = await db.user.create({
    data: { email, name: 'Platform Administrator', passwordHash: await hashPassword(password), platformRole: 'SUPER_ADMIN', mustChangePassword: true },
  })
  await writeAudit({ action: 'platform.admin_bootstrapped', entityType: 'User', entityId: user.id, after: { email } })
  console.log(`Super Admin created: ${email}. Sign in, set up two-step verification, then change the password.`)
}
await db.$disconnect()
