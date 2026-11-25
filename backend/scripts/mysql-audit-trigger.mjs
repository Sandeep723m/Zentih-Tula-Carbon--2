// MySQL equivalent of the PostgreSQL append-only AuditLog trigger (see the init migration).
// Shared hosting often withholds the TRIGGER privilege; then the app still never edits audit rows,
// but the database does not enforce it, so this warns instead of failing the setup.
import mariadb from 'mariadb'

for (const file of ['.env', 'private/.env']) try { process.loadEnvFile(file) } catch { /* missing; rely on real env vars */ }
const url = process.env.DATABASE_URL ?? ''
if (!url.startsWith('mysql://')) throw new Error('DATABASE_URL must be a mysql:// URL')

const conn = await mariadb.createConnection(url.replace(/^mysql:/, 'mariadb:'))
try {
  for (const op of ['UPDATE', 'DELETE']) {
    const name = `audit_log_no_${op.toLowerCase()}`
    await conn.query(`DROP TRIGGER IF EXISTS ${name}`)
    await conn.query(`CREATE TRIGGER ${name} BEFORE ${op} ON AuditLog FOR EACH ROW SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'AuditLog is append-only'`)
  }
  console.log('AuditLog append-only triggers installed')
} catch (e) {
  console.warn(`WARNING: could not install AuditLog triggers (${e.message}). The audit log is not database-enforced on this host.`)
} finally {
  await conn.end()
}
