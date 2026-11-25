import { PrismaMariaDb } from '@prisma/adapter-mariadb'
import { PrismaPg } from '@prisma/adapter-pg'
import { PrismaClient } from '../../generated/prisma/client.js'
import { env } from './env.js'

let client: PrismaClient | undefined

export const isMySql = () => (env.DATABASE_URL ?? '').startsWith('mysql://')

// Created on first use so the server starts without a running database.
export function getPrisma(): PrismaClient {
  if (!env.DATABASE_URL) throw new Error('DATABASE_URL is not configured')
  if (isMySql()) {
    client ??= new PrismaClient({ adapter: new PrismaMariaDb(env.DATABASE_URL.replace(/^mysql:/, 'mariadb:')) })
    return client
  }
  // The pg driver ignores "?schema=" in the URL, so pass it explicitly. Without this, tests
  // (which use ?schema=test) would run against — and wipe — the public schema.
  const schema = new URL(env.DATABASE_URL).searchParams.get('schema') ?? 'public'
  client ??= new PrismaClient({ adapter: new PrismaPg({ connectionString: env.DATABASE_URL }, { schema }) })
  return client
}
