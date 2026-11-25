// A small ZIP writer on Node's built-in zlib (deflate + crc32), for evidence pack downloads.
// ponytail: builds the archive in memory; stream it if packs grow past a few hundred MB.
import { crc32, deflateRawSync } from 'node:zlib'

export function zip(files: Array<{ name: string; data: Buffer }>): Buffer {
  const parts: Buffer[] = [], central: Buffer[] = []
  let offset = 0
  const now = new Date()
  const time = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)
  const date = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()
  for (const f of files) {
    const name = Buffer.from(f.name, 'utf8')
    const packed = deflateRawSync(f.data)
    const crc = crc32(f.data)
    const head = Buffer.alloc(30)
    head.writeUInt32LE(0x04034b50, 0); head.writeUInt16LE(20, 4); head.writeUInt16LE(0x0800, 6); head.writeUInt16LE(8, 8)
    head.writeUInt16LE(time, 10); head.writeUInt16LE(date, 12); head.writeUInt32LE(crc, 14)
    head.writeUInt32LE(packed.length, 18); head.writeUInt32LE(f.data.length, 22); head.writeUInt16LE(name.length, 26)
    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0); dir.writeUInt16LE(20, 4); dir.writeUInt16LE(20, 6); dir.writeUInt16LE(0x0800, 8); dir.writeUInt16LE(8, 10)
    dir.writeUInt16LE(time, 12); dir.writeUInt16LE(date, 14); dir.writeUInt32LE(crc, 16); dir.writeUInt32LE(packed.length, 20)
    dir.writeUInt32LE(f.data.length, 24); dir.writeUInt16LE(name.length, 28); dir.writeUInt32LE(offset, 42)
    parts.push(head, name, packed); central.push(dir, name)
    offset += head.length + name.length + packed.length
  }
  const size = central.reduce((s, b) => s + b.length, 0)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(files.length, 8); end.writeUInt16LE(files.length, 10)
  end.writeUInt32LE(size, 12); end.writeUInt32LE(offset, 16)
  return Buffer.concat([...parts, ...central, end])
}

// CSV with every value quoted; a leading = + - @ is prefixed so spreadsheets never run it as a formula.
export function csv(rows: Array<Record<string, unknown>>): Buffer {
  if (!rows.length) return Buffer.from('')
  const cols = Object.keys(rows[0])
  const cell = (v: unknown) => {
    let s = v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : typeof v === 'object' ? JSON.stringify(v) : String(v)
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`
    return `"${s.replace(/"/g, '""')}"`
  }
  return Buffer.from('﻿' + [cols.map(cell).join(','), ...rows.map((r) => cols.map((c) => cell(r[c])).join(','))].join('\r\n'))
}
