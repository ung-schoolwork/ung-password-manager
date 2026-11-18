import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import { parseCredentialRecords } from "@/lib/vault/csv-import"
import { readXlsxFirstSheet, XlsxReadError } from "@/lib/vault/xlsx-reader"

const fixture = readFileSync(
  join(import.meta.dir, "../../fixtures/credentials.xlsx")
)

type ZipPart = {
  name: string
  body: string | Uint8Array<ArrayBuffer>
  store?: boolean
  /** Overrides the uncompressed size written into the ZIP headers. */
  declaredSize?: number
}

/** Builds a minimal ZIP archive (no CRCs; the reader doesn't need them). */
function makeZip(parts: ZipPart[]): Uint8Array {
  const encoder = new TextEncoder()
  const locals: Uint8Array[] = []
  const centrals: Uint8Array[] = []
  let offset = 0

  for (const part of parts) {
    const name = encoder.encode(part.name)
    const raw =
      typeof part.body === "string" ? encoder.encode(part.body) : part.body
    const data = part.store ? raw : Bun.deflateSync(raw.slice())
    const method = part.store ? 0 : 8
    const size = part.declaredSize ?? raw.length

    const local = new Uint8Array(30 + name.length + data.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(8, method, true)
    lv.setUint32(18, data.length, true)
    lv.setUint32(22, size, true)
    lv.setUint16(26, name.length, true)
    local.set(name, 30)
    local.set(data, 30 + name.length)

    const central = new Uint8Array(46 + name.length)
    const cv = new DataView(central.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(10, method, true)
    cv.setUint32(20, data.length, true)
    cv.setUint32(24, size, true)
    cv.setUint16(28, name.length, true)
    cv.setUint32(42, offset, true)
    central.set(name, 46)

    locals.push(local)
    centrals.push(central)
    offset += local.length
  }

  const directorySize = centrals.reduce((sum, part) => sum + part.length, 0)
  const end = new Uint8Array(22)
  const ev = new DataView(end.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, parts.length, true)
  ev.setUint16(10, parts.length, true)
  ev.setUint32(12, directorySize, true)
  ev.setUint32(16, offset, true)

  const out = new Uint8Array(offset + directorySize + 22)
  let at = 0
  for (const chunk of [...locals, ...centrals, end]) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

const NS = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'

function workbook(sheetXml: string, extra: ZipPart[] = []): Uint8Array {
  return makeZip([
    { name: "xl/workbook.xml", body: `<workbook ${NS}><sheets/></workbook>` },
    { name: "xl/worksheets/sheet1.xml", body: sheetXml },
    ...extra,
  ])
}

async function readError(input: Uint8Array, options = {}) {
  try {
    await readXlsxFirstSheet(input, options)
  } catch (error) {
    return error
  }
  throw new Error("expected the read to fail")
}

describe("readXlsxFirstSheet", () => {
  it("reads the first sheet of the fixture workbook with every cell type", async () => {
    const records = await readXlsxFirstSheet(fixture)

    expect(records).toEqual([
      {
        line: 1,
        fields: ["Account", "Website", "Username", "Password", "Notes"],
      },
      {
        line: 2,
        fields: [
          "Campus Portal",
          "portal.example.edu",
          "student01",
          "123456",
          "TRUE",
        ],
      },
      {
        line: 4,
        fields: [
          "Tom & Jerry's <Shop>",
          "shop.example",
          "tom@example.com",
          "  P@ss, word  ",
        ],
      },
      { line: 6, fields: ["Library", "", "reader", "Books!2"] },
    ])
  })

  it("feeds the same row validation as CSV imports", async () => {
    const result = parseCredentialRecords(await readXlsxFirstSheet(fixture))

    expect(result.okCount).toBe(2)
    expect(result.rows[1]).toMatchObject({
      line: 4,
      status: "ok",
      data: { password: "  P@ss, word  " },
    })
    expect(result.rows[2]).toEqual({
      line: 6,
      status: "issue",
      reason: "Missing website or app.",
      raw: ["Library", "", "reader", "Books!2"],
    })
  })

  it("places cells by reference, fills gaps, and numbers rows without r", async () => {
    const records = await readXlsxFirstSheet(
      workbook(
        `<worksheet ${NS}><sheetData>` +
          '<row><c t="inlineStr"><is><t>a</t></is></c><c r="C1"><v>3.5</v></c></row>' +
          '<row><c t="inlineStr"><is><t/></is></c></row>' +
          '<row><c><v>7</v></c><c t="e"><v>#N/A</v></c></row>' +
          "</sheetData></worksheet>",
        [{ name: "xl/sharedStrings.xml", body: "<sst/>", store: true }]
      )
    )

    expect(records).toEqual([
      { line: 1, fields: ["a", "", "3.5"] },
      { line: 3, fields: ["7", "#N/A"] },
    ])
  })

  it("rejects files that are not ZIP archives", async () => {
    const error = await readError(new TextEncoder().encode("name,url\n"))
    expect(error).toBeInstanceOf(XlsxReadError)
    expect((error as XlsxReadError).code).toBe("not-xlsx")
  })

  it("rejects ZIP archives that are not workbooks", async () => {
    const error = await readError(makeZip([{ name: "a.txt", body: "hi" }]))
    expect((error as XlsxReadError).code).toBe("not-xlsx")
  })

  it("rejects password-protected workbooks", async () => {
    const cfb = new Uint8Array(512)
    cfb.set([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1])
    expect(((await readError(cfb)) as XlsxReadError).code).toBe("protected")
  })

  it("rejects parts whose declared size is over the limit before inflating", async () => {
    const bomb = workbook(`<worksheet ${NS}/>`, [
      {
        name: "xl/sharedStrings.xml",
        body: "<sst/>",
        declaredSize: 50 * 1024 * 1024,
      },
    ])
    expect(((await readError(bomb)) as XlsxReadError).code).toBe("too-large")
  })

  it("stops inflating when a part grows past its declared size", async () => {
    const big = `<worksheet ${NS}><sheetData>${"<row/>".repeat(200_000)}</sheetData></worksheet>`
    const lying = makeZip([
      { name: "xl/workbook.xml", body: `<workbook ${NS}/>` },
      { name: "xl/worksheets/sheet1.xml", body: big, declaredSize: 1024 },
    ])
    expect(((await readError(lying)) as XlsxReadError).code).toBe("damaged")
  })

  it("stops once the row limit is passed", async () => {
    const rows = Array.from(
      { length: 5 },
      (_, i) => `<row r="${i + 1}"><c><v>${i}</v></c></row>`
    ).join("")
    const error = await readError(
      workbook(`<worksheet ${NS}><sheetData>${rows}</sheetData></worksheet>`),
      { maxRecords: 3 }
    )
    expect((error as XlsxReadError).code).toBe("too-many-rows")
  })

  it("refuses XML with a document type declaration", async () => {
    const error = await readError(
      workbook(
        `<!DOCTYPE x [<!ENTITY a "aaaa">]><worksheet ${NS}><sheetData/></worksheet>`
      )
    )
    expect((error as XlsxReadError).code).toBe("damaged")
  })

  it("reports corrupt compressed data as damaged", async () => {
    const zip = workbook(`<worksheet ${NS}/>`)
    // Corrupt the first part's compressed bytes.
    zip.fill(
      0xff,
      30 + "xl/workbook.xml".length,
      30 + "xl/workbook.xml".length + 8
    )
    expect(((await readError(zip)) as XlsxReadError).code).toBe("damaged")
  })
})
