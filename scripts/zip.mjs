import { createHash } from 'node:crypto'
import { readFileSync, statSync, readdirSync } from 'node:fs'
import { join, relative, sep } from 'node:path'
import { deflateRawSync } from 'node:zlib'

// A tiny ZIP writer, so packaging needs no dependency and behaves the same on
// every machine. Only what a static web bundle needs: deflate or store, no
// encryption, no zip64, no directory entries (itch.io and every browser-facing
// unzipper infer folders from the entry paths).

const CRC_TABLE = (() => {
  const table = new Int32Array(256)
  for (let n = 0; n < 256; n += 1) {
    let c = n
    for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c
  }
  return table
})()

const crc32 = (buf) => {
  let c = -1
  for (let i = 0; i < buf.length; i += 1) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ -1) >>> 0
}

/** Every file under `dir`, as paths relative to it, with forward slashes. */
export const walk = (dir, base = dir) =>
  readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) return walk(full, base)
    return [relative(base, full).split(sep).join('/')]
  })

/**
 * Builds a ZIP from `entries` ([path, Buffer]) and returns it as one Buffer.
 * MS-DOS timestamps are fixed, so the same input always gives the same bytes
 * and a rebuild that changed nothing has the same hash.
 */
export const zip = (entries) => {
  const DOS_TIME = 0 // 00:00
  const DOS_DATE = (2026 - 1980) << 9 | (1 << 5) | 1 // 2026-01-01
  const locals = []
  const central = []
  let offset = 0

  for (const [name, raw] of entries) {
    const nameBuf = Buffer.from(name, 'utf8')
    const deflated = deflateRawSync(raw, { level: 9 })
    // Storing is better than inflating something already compressed (png, ogg).
    const stored = deflated.length >= raw.length
    const body = stored ? raw : deflated
    const method = stored ? 0 : 8
    const crc = crc32(raw)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed
    local.writeUInt16LE(0x0800, 6) // UTF-8 names
    local.writeUInt16LE(method, 8)
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(body.length, 18)
    local.writeUInt32LE(raw.length, 22)
    local.writeUInt16LE(nameBuf.length, 26)
    locals.push(local, nameBuf, body)

    const dir = Buffer.alloc(46)
    dir.writeUInt32LE(0x02014b50, 0)
    dir.writeUInt16LE(20, 4) // version made by
    dir.writeUInt16LE(20, 6) // version needed
    dir.writeUInt16LE(0x0800, 8)
    dir.writeUInt16LE(method, 10)
    dir.writeUInt16LE(DOS_TIME, 12)
    dir.writeUInt16LE(DOS_DATE, 14)
    dir.writeUInt32LE(crc, 16)
    dir.writeUInt32LE(body.length, 20)
    dir.writeUInt32LE(raw.length, 24)
    dir.writeUInt16LE(nameBuf.length, 28)
    dir.writeUInt32LE(offset, 42)
    central.push(dir, nameBuf)

    offset += local.length + nameBuf.length + body.length
  }

  const centralBuf = Buffer.concat(central)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralBuf.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...locals, centralBuf, end])
}

/** Reads a directory into zip entries, in a stable order. */
export const entriesFrom = (dir, paths = walk(dir).sort()) =>
  paths.map((p) => [p, readFileSync(join(dir, p))])

export const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

export const sizeOf = (path) => statSync(path).size
