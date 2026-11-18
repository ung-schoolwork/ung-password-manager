// A minimal ZIP writer (DEFLATE, no ZIP64) for packaging the built extension,
// so the download needs neither a `zip` binary nor an extra dependency.
import { deflateRawSync } from "node:zlib"

export interface ZipEntry {
  /** Path inside the archive, with forward slashes. */
  name: string
  data: Uint8Array
}

const CRC_TABLE = Array.from({ length: 256 }, (_, index) => {
  let value = index
  for (let bit = 0; bit < 8; bit++)
    value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1
  return value >>> 0
})

export function crc32(data: Uint8Array) {
  let crc = 0xffffffff
  for (const byte of data) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8)
  return (crc ^ 0xffffffff) >>> 0
}

// A fixed timestamp (1 Jan 2000, in MS-DOS format) keeps the archive
// byte-for-byte reproducible for the same files.
const DOS_TIME = 0
const DOS_DATE = ((2000 - 1980) << 9) | (1 << 5) | 1

export function createZip(entries: ZipEntry[]) {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let offset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name, "utf8")
    const compressed = deflateRawSync(entry.data, { level: 9 })
    const crc = crc32(entry.data)

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // version needed to extract
    local.writeUInt16LE(0x0800, 6) // flags: UTF-8 names
    local.writeUInt16LE(8, 8) // method: DEFLATE
    local.writeUInt16LE(DOS_TIME, 10)
    local.writeUInt16LE(DOS_DATE, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(compressed.length, 18)
    local.writeUInt32LE(entry.data.length, 22)
    local.writeUInt16LE(name.length, 26)
    local.writeUInt16LE(0, 28) // extra field length

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // version made by
    central.writeUInt16LE(20, 6) // version needed to extract
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt16LE(DOS_TIME, 12)
    central.writeUInt16LE(DOS_DATE, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(compressed.length, 20)
    central.writeUInt32LE(entry.data.length, 24)
    central.writeUInt16LE(name.length, 28)
    // Extra, comment, disk number, and attributes stay zero.
    central.writeUInt32LE(offset, 42)

    localParts.push(local, name, compressed)
    centralParts.push(central, name)
    offset += local.length + name.length + compressed.length
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.length, 12)
  end.writeUInt32LE(offset, 16)

  return Buffer.concat([...localParts, centralDirectory, end])
}
