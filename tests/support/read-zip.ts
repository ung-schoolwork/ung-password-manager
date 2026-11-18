// Reads a ZIP archive through its central directory, checking every entry's
// CRC, so tests confirm the extension download unzips cleanly.
import { inflateRawSync } from "node:zlib"

import { crc32 } from "../../extension/zip"

export function readZip(bytes: Uint8Array) {
  const zip = Buffer.from(bytes)
  const end = zip.length - 22
  if (zip.readUInt32LE(end) !== 0x06054b50)
    throw new Error("Missing end of central directory")
  const count = zip.readUInt16LE(end + 10)
  let at = zip.readUInt32LE(end + 16)
  const files = new Map<string, Buffer>()

  for (let index = 0; index < count; index++) {
    if (zip.readUInt32LE(at) !== 0x02014b50)
      throw new Error("Bad central directory entry")
    const method = zip.readUInt16LE(at + 10)
    const crc = zip.readUInt32LE(at + 16)
    const compressedSize = zip.readUInt32LE(at + 20)
    const size = zip.readUInt32LE(at + 24)
    const nameLength = zip.readUInt16LE(at + 28)
    const skip = zip.readUInt16LE(at + 30) + zip.readUInt16LE(at + 32)
    const local = zip.readUInt32LE(at + 42)
    const name = zip.toString("utf8", at + 46, at + 46 + nameLength)
    at += 46 + nameLength + skip

    if (zip.readUInt32LE(local) !== 0x04034b50)
      throw new Error(`Bad local header for ${name}`)
    const start =
      local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28)
    const stored = zip.subarray(start, start + compressedSize)
    const data = method === 8 ? inflateRawSync(stored) : Buffer.from(stored)
    if (data.length !== size || crc32(data) !== crc)
      throw new Error(`Corrupt entry ${name}`)
    files.set(name, data)
  }
  return files
}
