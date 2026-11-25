import { createReadStream } from 'node:fs'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { Readable } from 'node:stream'
import { env } from '../config/env.js'

// Evidence file storage. Keys are server-generated (never user file names).
// To use S3/Azure/GCS, implement this interface and export it below instead.
export interface FileStorage {
  put(key: string, data: Buffer): Promise<void>
  read(key: string): Readable
  remove(key: string): Promise<void>
}

const KEY = /^[a-z0-9-]+\/[a-z0-9-]+$/ // "<orgId>/<uuid>": no traversal possible

function localDisk(root: string): FileStorage {
  const file = (key: string) => {
    if (!KEY.test(key)) throw new Error(`Invalid storage key: ${key}`)
    return path.join(root, key)
  }
  return {
    async put(key, data) {
      await mkdir(path.dirname(file(key)), { recursive: true })
      await writeFile(file(key), data, { flag: 'wx' }) // never overwrite
    },
    read: (key) => createReadStream(file(key)),
    remove: (key) => rm(file(key), { force: true }),
  }
}

export const storage: FileStorage = localDisk(path.resolve(env.STORAGE_DIR))
