import { describe, expect, it } from "bun:test"
import { readFileSync } from "node:fs"
import { join } from "node:path"

import {
  ImportFileError,
  MAX_IMPORT_FILE_BYTES,
  readImportFile,
} from "@/lib/vault/import-file"
import { buildImportReport } from "@/lib/vault/import-report"

const XLSX_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
const fixture = readFileSync(
  join(import.meta.dir, "../../fixtures/credentials.xlsx")
)

async function errorMessage(file: File) {
  try {
    await readImportFile(file)
  } catch (error) {
    expect(error).toBeInstanceOf(ImportFileError)
    return (error as Error).message
  }
  throw new Error("expected the read to fail")
}

describe("readImportFile", () => {
  it("reads .xlsx and .csv files into the same rows", async () => {
    const xlsx = await readImportFile(
      new File([fixture], "logins.xlsx", { type: XLSX_TYPE })
    )
    const csv = await readImportFile(
      new File(
        [
          "Account,Website,Username,Password,Notes\n" +
            "Campus Portal,portal.example.edu,student01,123456,TRUE\n",
        ],
        "logins.csv",
        { type: "text/csv" }
      )
    )

    expect(xlsx.rows[0]).toEqual(csv.rows[0])
    expect(xlsx.okCount).toBe(2)
    expect(xlsx.issueCount).toBe(1)
  })

  it("accepts CSV files labeled with the legacy Excel type", async () => {
    const result = await readImportFile(
      new File(["name,url,username,password\nA,a.example,me,pw\n"], "a.csv", {
        type: "application/vnd.ms-excel",
      })
    )
    expect(result.okCount).toBe(1)
  })

  it("rejects other file types, including legacy .xls", async () => {
    expect(await errorMessage(new File(["x"], "notes.txt"))).toContain(
      ".csv or .xlsx"
    )
    expect(
      await errorMessage(
        new File(["x"], "old.xls", { type: "application/vnd.ms-excel" })
      )
    ).toContain(".csv or .xlsx")
  })

  it("rejects files over 5 MB without reading them", async () => {
    const file = new File(
      [new Uint8Array(MAX_IMPORT_FILE_BYTES + 1)],
      "big.csv"
    )
    expect(await errorMessage(file)).toContain("larger than 5 MB")
  })

  it("rejects files with more than 5,000 data rows", async () => {
    const rows = Array.from({ length: 5001 }, (_, i) => `A${i},a.example,me,pw`)
    const file = new File(
      [`name,url,username,password\n${rows.join("\n")}`],
      "many.csv"
    )
    expect(await errorMessage(file)).toContain("more than 5,000 rows")
  })

  it("explains when a file named .xlsx isn't a workbook", async () => {
    expect(await errorMessage(new File(["name,url\n"], "fake.xlsx"))).toContain(
      "isn't an Excel workbook"
    )
  })

  it("rejects files with no rows", async () => {
    expect(await errorMessage(new File([""], "empty.csv"))).toContain(
      "doesn't have any rows"
    )
  })
})

describe("buildImportReport", () => {
  it("lists every row in file order as imported or failed with a reason", async () => {
    const parsed = await readImportFile(
      new File([fixture], "logins.xlsx", { type: XLSX_TYPE })
    )

    const report = buildImportReport(parsed, [
      { ok: true },
      { ok: false, reason: "Your vault is too large to save." },
    ])

    expect(report).toEqual({
      rows: [
        {
          line: 2,
          status: "imported",
          accountName: "Campus Portal",
          siteOrApp: "portal.example.edu",
        },
        {
          line: 4,
          status: "failed",
          reason: "Your vault is too large to save.",
        },
        { line: 6, status: "failed", reason: "Missing website or app." },
      ],
      importedCount: 1,
      failedCount: 2,
    })
  })

  it("treats rows without a save result as failed", () => {
    const report = buildImportReport(
      {
        rows: [
          {
            line: 2,
            status: "ok",
            data: {
              accountName: "A",
              siteOrApp: "a",
              username: "u",
              password: "p",
            },
          },
        ],
        okCount: 1,
        issueCount: 0,
      },
      []
    )
    expect(report.rows[0]).toMatchObject({ status: "failed" })
    expect(report.failedCount).toBe(1)
  })
})
