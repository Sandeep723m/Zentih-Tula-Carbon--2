import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'
import { env } from '../config/env.js'
import { HttpError } from '../middleware/errorHandler.js'

// ---- Authenticator secrets at rest (AES-256-GCM) ---------------------------
// Stored as "enc1:<iv>.<tag>.<ciphertext>". A secret without the prefix is from before encryption
// was set up; it still works and is encrypted the next time its owner signs in.
export const SEALED_PREFIX = 'enc1:'
const mfaKey = () => (env.MFA_ENCRYPTION_KEY ? createHash('sha256').update(env.MFA_ENCRYPTION_KEY).digest() : null)

export function sealSecret(plain: string): string {
  const key = mfaKey()
  if (!key) return plain
  const iv = randomBytes(12)
  const c = createCipheriv('aes-256-gcm', key, iv)
  const data = Buffer.concat([c.update(plain, 'utf8'), c.final()])
  return SEALED_PREFIX + [iv, c.getAuthTag(), data].map((b) => b.toString('base64url')).join('.')
}

export function openSecret(stored: string): string {
  if (!stored.startsWith(SEALED_PREFIX)) return stored
  const key = mfaKey()
  try {
    if (!key) throw new Error('MFA_ENCRYPTION_KEY is not set')
    const [iv, tag, data] = stored.slice(SEALED_PREFIX.length).split('.').map((p) => Buffer.from(p, 'base64url'))
    const d = createDecipheriv('aes-256-gcm', key, iv)
    d.setAuthTag(tag)
    return Buffer.concat([d.update(data), d.final()]).toString('utf8')
  } catch (e) {
    console.error('Authenticator secret could not be decrypted:', (e as Error).message) // missing or changed key
    throw new HttpError(503, 'Two-step verification is temporarily unavailable. Please contact support.')
  }
}

const scryptAsync = promisify(scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>

// ---- Passwords (scrypt) -------------------------------------------------

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await scryptAsync(password, salt, 64)
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algo, saltB64, hashB64] = stored.split('$')
  if (algo !== 'scrypt' || !saltB64 || !hashB64) return false
  const expected = Buffer.from(hashB64, 'base64')
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'), expected.length)
  return timingSafeEqual(actual, expected)
}

// Used when the email is unknown so response time does not reveal whether an account exists.
export const DUMMY_PASSWORD_HASH = await hashPassword(randomBytes(16).toString('hex'))

// ---- Session tokens -----------------------------------------------------

export const newToken = () => randomBytes(32).toString('base64url')
export const hashToken = (token: string) => createHash('sha256').update(token).digest('hex')

// ---- TOTP (RFC 6238: SHA-1, 6 digits, 30 s step) -------------------------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'

export function newTotpSecret(): string {
  const bytes = randomBytes(20)
  let bits = ''
  for (const b of bytes) bits += b.toString(2).padStart(8, '0')
  let out = ''
  for (let i = 0; i + 5 <= bits.length; i += 5) out += B32[parseInt(bits.slice(i, i + 5), 2)]
  return out
}

function base32Decode(s: string): Buffer {
  let bits = ''
  for (const c of s.replace(/=+$/, '').toUpperCase()) {
    const v = B32.indexOf(c)
    if (v < 0) throw new Error('Invalid base32')
    bits += v.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

export const totpStep = (now = Date.now()) => Math.floor(now / 1000 / 30)

export function totpCode(secret: string, step: number): string {
  const counter = Buffer.alloc(8)
  counter.writeBigUInt64BE(BigInt(step))
  const h = createHmac('sha1', base32Decode(secret)).update(counter).digest()
  const offset = h[h.length - 1] & 0xf
  const num = (h.readUInt32BE(offset) & 0x7fffffff) % 1_000_000
  return num.toString().padStart(6, '0')
}

// Returns the matched step (allowing ±1 step of clock drift), or null.
export function matchTotp(secret: string, code: string, now = Date.now()): number | null {
  if (!/^\d{6}$/.test(code)) return null
  const current = totpStep(now)
  for (const step of [current - 1, current, current + 1]) {
    if (timingSafeEqual(Buffer.from(totpCode(secret, step)), Buffer.from(code))) return step
  }
  return null
}

export const otpauthUrl = (secret: string, email: string) =>
  `otpauth://totp/${encodeURIComponent(`Tula Carbon:${email}`)}?secret=${secret}&issuer=Tula%20Carbon&digits=6&period=30`
