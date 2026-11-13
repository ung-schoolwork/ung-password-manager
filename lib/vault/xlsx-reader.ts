/**
 * Minimal, dependency-free reader for the first worksheet of an .xlsx file.
 *
 * An .xlsx file is a ZIP archive of XML parts. We read the ZIP central
 * directory ourselves, inflate only the parts we need with the platform's
 * DecompressionStream("deflate-raw"), and scan the SpreadsheetML with a small
 * tag scanner (it runs in the browser and under `bun test`, where DOMParser
 * isn't available). Everything happens in memory; nothing is uploaded.
 *
 * Supported cell values: shared strings, inline strings, formula string
 * results, numbers (kept exactly as stored), booleans, errors, and blank
 * cells. Formatting, dates-as-dates, and other sheets are ignored.
 */

export type SheetRecord = { line: number; fields: string[] }

export type XlsxReadErrorCode =
  "not-xlsx" | "damaged" | "protected" | "too-large" | "too-many-rows"

const ERROR_MESSAGES: Record<XlsxReadErrorCode, string> = {
  "not-xlsx":
    "That file isn't an Excel workbook. Save it as .xlsx or .csv and try again.",
  damaged:
    "We couldn't read that spreadsheet. Open it in your spreadsheet app, save it again as .xlsx, and try again.",
  protected:
    "That spreadsheet is password-protected or in an older Excel format. Save it as an unprotected .xlsx or .csv file and try again.",
  "too-large":
    "That spreadsheet is too large to import. Split it into smaller files and try again.",
  "too-many-rows":
    "That spreadsheet has too many rows to import at once. Split it into smaller files and try again.",
}

export class XlsxReadError extends Error {
  readonly code: XlsxReadErrorCode

  constructor(code: XlsxReadErrorCode) {
    super(ERROR_MESSAGES[code])
    this.name = "XlsxReadError"
    this.code = code
  }
}

export type XlsxReadOptions = {
  /** Largest uncompressed size accepted for any single part. */
  maxEntryBytes?: number
  /** Most non-blank rows (including the header row) to read. */
  maxRecords?: number
  /** Cells past this column are ignored. */
  maxColumns?: number
}

const DEFAULT_MAX_ENTRY_BYTES = 20 * 1024 * 1024
const DEFAULT_MAX_RECORDS = 5001
const DEFAULT_MAX_COLUMNS = 64

const SIG_LOCAL_HEADER = 0x04034b50
const SIG_CENTRAL_ENTRY = 0x02014b50
const SIG_END_OF_DIRECTORY = 0x06054b50
const CFB_SIGNATURE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]

type ZipEntry = {
  name: string
  method: number
  flags: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
}

export async function readXlsxFirstSheet(
  input: ArrayBuffer | Uint8Array,
  options: XlsxReadOptions = {}
): Promise<SheetRecord[]> {
  const bytes = input instanceof Uint8Array ? input : new Uint8Array(input)
  const maxEntryBytes = options.maxEntryBytes ?? DEFAULT_MAX_ENTRY_BYTES
  const maxRecords = options.maxRecords ?? DEFAULT_MAX_RECORDS
  const maxColumns = options.maxColumns ?? DEFAULT_MAX_COLUMNS

  if (CFB_SIGNATURE.every((byte, index) => bytes[index] === byte)) {
    // Encrypted .xlsx and legacy .xls files are OLE compound files.
    throw new XlsxReadError("protected")
  }

  const entries = readCentralDirectory(bytes)
  const readPart = async (name: string): Promise<string | null> => {
    const entry = entries.get(name)
    if (!entry) return null
    return extractText(bytes, entry, maxEntryBytes)
  }

  const workbookXml = await readPart("xl/workbook.xml")
  if (workbookXml === null) throw new XlsxReadError("not-xlsx")

  const sheetPath = await resolveFirstSheetPath(workbookXml, readPart)
  const sheetXml = sheetPath ? await readPart(sheetPath) : null
  if (sheetXml === null) throw new XlsxReadError("damaged")

  const sharedStringsXml = await readPart("xl/sharedStrings.xml")
  const sharedStrings = sharedStringsXml
    ? parseSharedStrings(sharedStringsXml)
    : []

  return parseWorksheet(sheetXml, sharedStrings, maxRecords, maxColumns)
}

// ---------------------------------------------------------------------------
// ZIP

function readCentralDirectory(bytes: Uint8Array): Map<string, ZipEntry> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  if (bytes.length < 22 || view.getUint32(0, true) !== SIG_LOCAL_HEADER) {
    throw new XlsxReadError("not-xlsx")
  }

  // The end-of-central-directory record sits in the last 22 + 65535 bytes.
  let eocd = -1
  const stop = Math.max(0, bytes.length - 22 - 0xffff)
  for (let offset = bytes.length - 22; offset >= stop; offset--) {
    if (view.getUint32(offset, true) === SIG_END_OF_DIRECTORY) {
      eocd = offset
      break
    }
  }
  if (eocd < 0) throw new XlsxReadError("damaged")

  const entryCount = view.getUint16(eocd + 10, true)
  const directorySize = view.getUint32(eocd + 12, true)
  const directoryOffset = view.getUint32(eocd + 16, true)
  if (
    entryCount === 0xffff ||
    directoryOffset === 0xffffffff ||
    directoryOffset + directorySize > eocd
  ) {
    // ZIP64 archives are far larger than anything we'd accept.
    throw new XlsxReadError("damaged")
  }

  const decoder = new TextDecoder()
  const entries = new Map<string, ZipEntry>()
  let offset = directoryOffset
  for (let index = 0; index < entryCount; index++) {
    if (
      offset + 46 > eocd ||
      view.getUint32(offset, true) !== SIG_CENTRAL_ENTRY
    ) {
      throw new XlsxReadError("damaged")
    }
    const nameLength = view.getUint16(offset + 28, true)
    const extraLength = view.getUint16(offset + 30, true)
    const commentLength = view.getUint16(offset + 32, true)
    const nameEnd = offset + 46 + nameLength
    if (nameEnd > eocd) throw new XlsxReadError("damaged")

    const name = decoder.decode(bytes.subarray(offset + 46, nameEnd))
    entries.set(name, {
      name,
      flags: view.getUint16(offset + 8, true),
      method: view.getUint16(offset + 10, true),
      compressedSize: view.getUint32(offset + 20, true),
      uncompressedSize: view.getUint32(offset + 24, true),
      localHeaderOffset: view.getUint32(offset + 42, true),
    })
    offset = nameEnd + extraLength + commentLength
  }
  return entries
}

async function extractText(
  bytes: Uint8Array,
  entry: ZipEntry,
  maxEntryBytes: number
): Promise<string> {
  if (entry.flags & 0x1) throw new XlsxReadError("protected")
  // Reject zip bombs up front from the declared size; the inflate step
  // below also stops as soon as the real output passes that size.
  if (entry.uncompressedSize > maxEntryBytes) {
    throw new XlsxReadError("too-large")
  }

  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
  const header = entry.localHeaderOffset
  if (
    header + 30 > bytes.length ||
    view.getUint32(header, true) !== SIG_LOCAL_HEADER
  ) {
    throw new XlsxReadError("damaged")
  }
  const dataStart =
    header +
    30 +
    view.getUint16(header + 26, true) +
    view.getUint16(header + 28, true)
  const dataEnd = dataStart + entry.compressedSize
  if (dataEnd > bytes.length) throw new XlsxReadError("damaged")
  const compressed = bytes.subarray(dataStart, dataEnd)

  let raw: Uint8Array
  if (entry.method === 0) {
    raw = compressed
  } else if (entry.method === 8) {
    raw = await inflateRaw(compressed, entry.uncompressedSize)
  } else {
    throw new XlsxReadError("damaged")
  }
  if (raw.length !== entry.uncompressedSize) throw new XlsxReadError("damaged")

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(raw)
  } catch {
    throw new XlsxReadError("damaged")
  }
}

async function inflateRaw(
  compressed: Uint8Array,
  limit: number
): Promise<Uint8Array> {
  const stream = new Blob([compressed.slice()])
    .stream()
    .pipeThrough(new DecompressionStream("deflate-raw"))
  const reader = stream.getReader()
  const chunks: Uint8Array[] = []
  let total = 0

  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > limit) {
        await reader.cancel().catch(() => {})
        throw new XlsxReadError("damaged")
      }
      chunks.push(value)
    }
  } catch (error) {
    if (error instanceof XlsxReadError) throw error
    throw new XlsxReadError("damaged")
  }

  const output = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    output.set(chunk, offset)
    offset += chunk.byteLength
  }
  return output
}

// ---------------------------------------------------------------------------
// XML scanning

type XmlHandlers = {
  open?(
    name: string,
    attributes: Record<string, string>,
    selfClosing: boolean
  ): void
  close?(name: string): void
  text?(text: string): void
}

function localName(name: string): string {
  const colon = name.indexOf(":")
  return colon === -1 ? name : name.slice(colon + 1)
}

const ATTRIBUTE_PATTERN = /([^\s=/]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g

function parseAttributes(source: string): Record<string, string> {
  const attributes: Record<string, string> = {}
  for (const match of source.matchAll(ATTRIBUTE_PATTERN)) {
    attributes[match[1]] = decodeEntities(match[2] ?? match[3] ?? "")
  }
  return attributes
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
}

function decodeEntities(text: string): string {
  if (!text.includes("&")) return text
  return text.replace(
    /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g,
    (whole, body: string) => {
      if (body[0] === "#") {
        const code =
          body[1] === "x" || body[1] === "X"
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10)
        return Number.isFinite(code) && code <= 0x10ffff
          ? String.fromCodePoint(code)
          : whole
      }
      return NAMED_ENTITIES[body] ?? whole
    }
  )
}

/** Walks the elements of an XML document. Custom entities are never expanded. */
function scanXml(xml: string, handlers: XmlHandlers): void {
  let index = 0
  while (index < xml.length) {
    const lt = xml.indexOf("<", index)
    if (lt === -1) {
      handlers.text?.(decodeEntities(xml.slice(index)))
      break
    }
    if (lt > index) handlers.text?.(decodeEntities(xml.slice(index, lt)))

    if (xml.startsWith("<!--", lt)) {
      const end = xml.indexOf("-->", lt + 4)
      if (end === -1) throw new XlsxReadError("damaged")
      index = end + 3
      continue
    }
    if (xml.startsWith("<![CDATA[", lt)) {
      const end = xml.indexOf("]]>", lt + 9)
      if (end === -1) throw new XlsxReadError("damaged")
      handlers.text?.(xml.slice(lt + 9, end))
      index = end + 3
      continue
    }
    if (xml.startsWith("<?", lt)) {
      const end = xml.indexOf("?>", lt + 2)
      if (end === -1) throw new XlsxReadError("damaged")
      index = end + 2
      continue
    }
    if (xml.startsWith("<!", lt)) {
      // DOCTYPE never appears in SpreadsheetML; refuse rather than guess.
      throw new XlsxReadError("damaged")
    }

    const gt = findTagEnd(xml, lt + 1)
    if (gt === -1) throw new XlsxReadError("damaged")
    const inner = xml.slice(lt + 1, gt)
    index = gt + 1

    if (inner[0] === "/") {
      handlers.close?.(localName(inner.slice(1).trim()))
      continue
    }

    const selfClosing = inner.endsWith("/")
    const body = selfClosing ? inner.slice(0, -1) : inner
    const nameMatch = /^[^\s/]+/.exec(body)
    if (!nameMatch) throw new XlsxReadError("damaged")
    const name = localName(nameMatch[0])
    handlers.open?.(
      name,
      parseAttributes(body.slice(nameMatch[0].length)),
      selfClosing
    )
    if (selfClosing) handlers.close?.(name)
  }
}

/** Finds the `>` closing a tag, skipping any `>` inside quoted attribute values. */
function findTagEnd(xml: string, from: number): number {
  let quote: string | null = null
  for (let index = from; index < xml.length; index++) {
    const char = xml[index]
    if (quote) {
      if (char === quote) quote = null
    } else if (char === '"' || char === "'") {
      quote = char
    } else if (char === ">") {
      return index
    }
  }
  return -1
}

// ---------------------------------------------------------------------------
// SpreadsheetML

async function resolveFirstSheetPath(
  workbookXml: string,
  readPart: (name: string) => Promise<string | null>
): Promise<string | null> {
  let relationshipId: string | null = null
  scanXml(workbookXml, {
    open(name, attributes) {
      if (name !== "sheet" || relationshipId !== null) return
      const idKey = Object.keys(attributes).find(
        (key) => localName(key) === "id" && key.includes(":")
      )
      relationshipId = idKey ? attributes[idKey] : ""
    },
  })

  const relsXml = await readPart("xl/_rels/workbook.xml.rels")
  if (relationshipId && relsXml) {
    let target: string | null = null
    scanXml(relsXml, {
      open(name, attributes) {
        if (name === "Relationship" && attributes.Id === relationshipId) {
          target = attributes.Target ?? null
        }
      },
    })
    if (target) return resolvePartPath("xl/", target)
  }

  return "xl/worksheets/sheet1.xml"
}

function resolvePartPath(base: string, target: string): string {
  if (target.startsWith("/")) return target.slice(1)
  const parts = base.split("/").filter(Boolean)
  for (const segment of target.split("/")) {
    if (segment === "..") parts.pop()
    else if (segment && segment !== ".") parts.push(segment)
  }
  return parts.join("/")
}

function parseSharedStrings(xml: string): string[] {
  const strings: string[] = []
  let current: string | null = null
  let inText = false
  let phoneticDepth = 0

  scanXml(xml, {
    open(name, _attributes, selfClosing) {
      if (name === "si") current = ""
      else if (name === "rPh") phoneticDepth++
      else if (name === "t" && !selfClosing) inText = true
    },
    close(name) {
      if (name === "si") {
        strings.push(current ?? "")
        current = null
      } else if (name === "rPh") phoneticDepth--
      else if (name === "t") inText = false
    },
    text(text) {
      if (inText && current !== null && phoneticDepth === 0) current += text
    },
  })

  return strings
}

function columnIndexFromRef(ref: string): number | null {
  const letters = /^[A-Za-z]+/.exec(ref)?.[0]
  if (!letters) return null
  let index = 0
  for (const letter of letters.toUpperCase()) {
    index = index * 26 + (letter.charCodeAt(0) - 64)
  }
  return index - 1
}

function parseWorksheet(
  xml: string,
  sharedStrings: string[],
  maxRecords: number,
  maxColumns: number
): SheetRecord[] {
  const records: SheetRecord[] = []
  let inSheetData = false
  let rowNumber = 0
  let rowCells: string[] = []
  let nextColumn = 0
  let cell: {
    column: number
    type: string
    value: string
    inline: string
  } | null = null
  let capture: "v" | "t" | null = null
  let inInlineString = false
  let phoneticDepth = 0

  const finishRow = () => {
    if (rowCells.some((value) => value.trim().length > 0)) {
      if (records.length >= maxRecords) {
        throw new XlsxReadError("too-many-rows")
      }
      const fields = Array.from(rowCells, (value) => value ?? "")
      records.push({ line: rowNumber, fields })
    }
  }

  const cellText = (current: NonNullable<typeof cell>): string => {
    switch (current.type) {
      case "s": {
        const index = Number(current.value.trim())
        return Number.isInteger(index) ? (sharedStrings[index] ?? "") : ""
      }
      case "inlineStr":
        return current.inline
      case "b":
        return current.value.trim() === "1" ? "TRUE" : "FALSE"
      default:
        return current.value
    }
  }

  scanXml(xml, {
    open(name, attributes, selfClosing) {
      if (name === "sheetData") {
        inSheetData = !selfClosing
        return
      }
      if (!inSheetData) return

      if (name === "row") {
        const declared = Number(attributes.r)
        rowNumber =
          Number.isInteger(declared) && declared > 0 ? declared : rowNumber + 1
        rowCells = []
        nextColumn = 0
      } else if (name === "c") {
        const column = attributes.r ? columnIndexFromRef(attributes.r) : null
        cell = {
          column: column ?? nextColumn,
          type: attributes.t ?? "n",
          value: "",
          inline: "",
        }
        nextColumn = cell.column + 1
      } else if (name === "is") {
        inInlineString = true
      } else if (name === "rPh") {
        phoneticDepth++
      } else if (cell && !selfClosing && name === "v") {
        capture = "v"
      } else if (cell && !selfClosing && name === "t" && inInlineString) {
        capture = "t"
      }
    },
    close(name) {
      if (name === "sheetData") {
        inSheetData = false
      } else if (!inSheetData) {
        return
      } else if (name === "row") {
        finishRow()
      } else if (name === "c" && cell) {
        if (cell.column < maxColumns) {
          while (rowCells.length < cell.column) rowCells.push("")
          rowCells[cell.column] = cellText(cell)
        }
        cell = null
      } else if (name === "is") {
        inInlineString = false
      } else if (name === "rPh") {
        phoneticDepth--
      } else if (name === "v" || name === "t") {
        capture = null
      }
    },
    text(text) {
      if (!cell || !capture || phoneticDepth > 0) return
      if (capture === "v") cell.value += text
      else cell.inline += text
    },
  })

  return records
}
