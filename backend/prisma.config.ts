import { defineConfig } from 'prisma/config'

for (const file of ['.env', 'private/.env']) try { process.loadEnvFile(file) } catch { /* missing; rely on real env vars */ }

const url = process.env.DATABASE_URL ?? ''
// PostgreSQL is the production database (versioned migrations). MySQL is only for the cPanel
// showcase: its schema is generated from the PostgreSQL one and applied with `prisma db push`.
const mysql = url.startsWith('mysql://')

export default defineConfig({
  schema: mysql ? 'prisma-mysql/schema.prisma' : 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url },
})
