import type { ImportParseResult } from "@/lib/vault/csv-import"

/** What happened when one ready row was saved, in the order the rows were sent. */
export type ImportSaveResult = { ok: true } | { ok: false; reason: string }

export type ImportReportRow =
  | { line: number; status: "imported"; accountName: string; siteOrApp: string }
  | { line: number; status: "failed"; reason: string }

export type ImportReport = {
  rows: ImportReportRow[]
  importedCount: number
  failedCount: number
}

export const SAVE_FAILED_REASON = "This row couldn't be saved. Try again."

/**
 * Combines the file review (rows skipped for problems) with the save results
 * (rows that were sent) into one list in file order.
 */
export function buildImportReport(
  parsed: ImportParseResult,
  saveResults: readonly ImportSaveResult[]
): ImportReport {
  let saveIndex = 0
  const rows = parsed.rows.map((row): ImportReportRow => {
    if (row.status === "issue") {
      return { line: row.line, status: "failed", reason: row.reason }
    }
    const saved = saveResults[saveIndex++] ?? {
      ok: false,
      reason: SAVE_FAILED_REASON,
    }
    return saved.ok
      ? {
          line: row.line,
          status: "imported",
          accountName: row.data.accountName,
          siteOrApp: row.data.siteOrApp,
        }
      : {
          line: row.line,
          status: "failed",
          reason: saved.reason || SAVE_FAILED_REASON,
        }
  })

  const importedCount = rows.filter((row) => row.status === "imported").length
  return { rows, importedCount, failedCount: rows.length - importedCount }
}
